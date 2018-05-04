define([
    "readium_shared_js/globalsSetup",
        "readium_shared_js/globals",
    './ModuleConfig',
    'jquery',
    'URIjs',
    './Spinner',
    'hgn!readium_js_viewer_html_templates/reader-body.html',
    './EpubReaderMediaOverlays',
    './EpubReaderBackgroundAudioTrack',
    './gestures',
    'readium_js/Readium',
    'readium_shared_js/helpers',
    'readium_shared_js/biblemesh_helpers',
    'readium_shared_js/models/bookmark_data',
    'biblemesh_AppComm'],
    
    function (
    globalSetup,
    Globals,
    moduleConfig,
    $,
    URI,
    spinner,
    ReaderBody,
    EpubReaderMediaOverlays,
    EpubReaderBackgroundAudioTrack,
    GesturesHandler,
    Readium,
    Helpers,
    biblemesh_Helpers,
    BookmarkData,
    biblemesh_AppComm){
    
        // initialised in initReadium()
        var readium = undefined;
    
        var biblemesh_isWidget = undefined;
        var biblemesh_widgetMetaData = undefined;
        var biblemesh_getPagesInfoFunc = undefined;
        var biblemesh_highlights = [];
        var biblemesh_highlightTouched = false;
        var biblemesh_textSelected = false;
        var biblemesh_preventAnnotationClick = false;
        var biblemesh_isMobileSafari = !!navigator.userAgent.match(/(iPad|iPhone|iPod)/);
        var biblemesh_currentLoadedPageBookmark;

        // initialised in loadReaderUI(), with passed data.epub
        var ebookURL = undefined;
        var ebookURL_filepath = undefined;
    
        // initialised in loadEbook() >> readium.openPackageDocument()
        var currentPackageDocument = undefined;
        
        // initialised in initReadium()
        // (variable not actually used anywhere here, but top-level to indicate that its lifespan is that of the reader object (not to be garbage-collected))
        var gesturesHandler = undefined;
    
        var ensureUrlIsRelativeToApp = function(ebookURL) {
    
            if (!ebookURL) {
                return ebookURL;
            }
            
            if (ebookURL.indexOf("http") != 0) {
                return ebookURL;
            }
                
            var isHTTPS = (ebookURL.indexOf("https") == 0);
        
            var CORS_PROXY_HTTP_TOKEN = "/http://";
            var CORS_PROXY_HTTPS_TOKEN = "/https://";
            
            // Ensures URLs like http://crossorigin.me/http://domain.com/etc
            // do not end-up loosing the double forward slash in http://domain.com
            // (because of URI.absoluteTo() path normalisation)
            var CORS_PROXY_HTTP_TOKEN_ESCAPED = "%2Fhttp%3A%2F%2F";
            var CORS_PROXY_HTTPS_TOKEN_ESCAPED = "%2Fhttps%3A%2F%2F";
            
            // case-insensitive regexp for percent-escapes
            var regex_CORS_PROXY_HTTPs_TOKEN_ESCAPED = new RegExp("%2F(http[s]?)%3A%2F%2F", "gi");
            
            var appUrl =
            window.location ? (
                window.location.protocol
                + "//"
                + window.location.hostname
                + (window.location.port ? (':' + window.location.port) : '')
                // + window.location.pathname
                + "/"  // biblemesh_
            ) : undefined;
            
            if (appUrl) {
                console.log("EPUB URL absolute: " + ebookURL);
                console.log("App URL: " + appUrl);
                
                ebookURL = ebookURL.replace(CORS_PROXY_HTTP_TOKEN, CORS_PROXY_HTTP_TOKEN_ESCAPED);
                ebookURL = ebookURL.replace(CORS_PROXY_HTTPS_TOKEN, CORS_PROXY_HTTPS_TOKEN_ESCAPED);
                
                ebookURL = new URI(ebookURL).relativeTo(appUrl).toString();
                if (ebookURL.indexOf("//") == 0) { // URI.relativeTo() sometimes returns "//domain.com/path" without the protocol
                    ebookURL = (isHTTPS ? "https:" : "http:") + ebookURL;
                }
                
                ebookURL = ebookURL.replace(regex_CORS_PROXY_HTTPs_TOKEN_ESCAPED, "/$1://");
                
                console.log("EPUB URL relative to app: " + ebookURL);
            }
            
            return ebookURL;
        };
    
        // This function will retrieve a package document and load an EPUB
        var loadEbook = function (openPageRequest) {
            readium.openPackageDocument(
                
                ebookURL,
                
                function(packageDocument, options){
                    if (!packageDocument) {
                        
                        console.error("ERROR OPENING EBOOK: " + ebookURL_filepath);
                        
                        spin(false);

                        biblemesh_AppComm.postMsg('reportError', {
                            errorCode: 'error opening package document',
                            info: {
                                filepath: ebookURL_filepath,
                            },
                        });
                        
                        return;
                    }
                    
                    currentPackageDocument = packageDocument;
                    currentPackageDocument.generateTocListDOM(function(dom){
                        loadToc(dom)
                    });
    
                    if(biblemesh_isWidget) {
                        biblemesh_widgetMetaData = {
                            title: metadata.title || "",
                            author: metadata.author || metadata.publisher || ""
                        };
                    }
    
                },
    
                openPageRequest
    
            );
        };
    
        var spin = function(on)
        {
            if (on) {
        //console.error("do SPIN: -- WILL: " + spinner.willSpin + " IS:" + spinner.isSpinning + " STOP REQ:" + spinner.stopRequested);
                if (spinner.willSpin || spinner.isSpinning) return;
        
                spinner.willSpin = true;
        
                setTimeout(function()
                {
                    if (spinner.stopRequested)
                    {
        //console.debug("STOP REQUEST: -- WILL: " + spinner.willSpin + " IS:" + spinner.isSpinning + " STOP REQ:" + spinner.stopRequested);
                        spinner.willSpin = false;
                        spinner.stopRequested = false;
                        return;
                    }
        //console.debug("SPIN: -- WILL: " + spinner.willSpin + " IS:" + spinner.isSpinning + " STOP REQ:" + spinner.stopRequested);
                    spinner.isSpinning = true;
                    spinner.spin($('#reading-area')[0]);
        
                    spinner.willSpin = false;
        
                }, 100);
            } else {
                
                if (spinner.isSpinning)
                {
    //console.debug("!! SPIN: -- WILL: " + spinner.willSpin + " IS:" + spinner.isSpinning + " STOP REQ:" + spinner.stopRequested);
                    spinner.stop();
                    spinner.isSpinning = false;
                }
                else if (spinner.willSpin)
                {
    //console.debug("!! SPIN REQ: -- WILL: " + spinner.willSpin + " IS:" + spinner.isSpinning + " STOP REQ:" + spinner.stopRequested);
                    spinner.stopRequested = true;
                }
            }
        };
        
        var loadToc = function(dom){
    
            readium.reader.on(ReadiumSDK.Events.CONTENT_DOCUMENT_LOADED, function ($iframe, spineItem)
            {
    
                Globals.logEvent("CONTENT_DOCUMENT_LOADED", "ON", "EpubReader.js [ " + spineItem.href + " ]");

                //TODO not picked-up by all screen readers, so for now this short description will suffice
                $iframe.attr("title", "EPUB");
                $iframe.attr("aria-label", "EPUB");
    
                if(biblemesh_isWidget) {
                    if(typeof biblemesh_isWidget != 'boolean') {
    
                        // put in start and end marker elements
                        var widgetScopeBookmarkData = new BookmarkData(biblemesh_isWidget.idref, biblemesh_isWidget.elementCfi);
                        var widgetScopeRange = readium.reader.getDomRangeFromRangeCfi(widgetScopeBookmarkData);
    
                        var startMarkerEl = $('<span></span>');
                        var endMarkerEl = $('<span></span>');
    
                        widgetScopeRange.insertNode(startMarkerEl[0]);
                        widgetScopeRange.collapse();
                        widgetScopeRange.insertNode(endMarkerEl[0]);
    
                        // hide all before start and after end
                        var widgetHide = function(baseEl, direction) {
                            var sibling = baseEl[0][direction + 'Sibling'];
                            while(sibling) {
                                if(sibling.nodeType == 3) {  // text node
                                    $(sibling).wrap('<span></span>');
                                    sibling = sibling.parentElement;
                                }
                                if(sibling.nodeType == 1) {  // element
                                    $(sibling)
                                        .css('cssText', $(sibling).attr('style') + ';display: none !important;')
                                        .attr('data-hiddenbywidget', '');
                                }
                                sibling = sibling[direction + 'Sibling'];
                            }
                            var baseElParent = baseEl.parent();
                            if(baseElParent.length > 0 && !baseElParent.is('body, html')) {
                                widgetHide(baseElParent, direction);
                            }
                        }
                        widgetHide(startMarkerEl, 'previous');
                        widgetHide(endMarkerEl, 'next');
    
                        // get rid of margin-top at the beginning, and margin-bottom at the end
                        var widgetRemoveMargin = function(baseEl, direction) {
                            var sibling = baseEl[0][direction + 'Sibling'];
                            while(sibling) {
                                if(sibling.nodeType == 3) {  // text node
                                    $(sibling).wrap('<span></span>');
                                    sibling = sibling.parentElement;
                                }
                                if(sibling.nodeType == 1) {  // element
                                    $(sibling)
                                        .css('cssText', $(sibling).attr('style') + ';display: none !important;')
                                        .attr('data-hiddenbywidget', '');
                                }
                                sibling = sibling[direction + 'Sibling'];
                            }
                            var baseElParent = baseEl.parent();
                            if(baseElParent.length > 0 && !baseElParent.is('body, html')) {
                                widgetHide(baseElParent, direction);
                            }
                        }
    
                        // remove markers
                        startMarkerEl.remove();
                        endMarkerEl.remove();
    
                    }
    
                    var doc = ( $iframe[0].contentWindow || $iframe[0].contentDocument ).document;
                    
                    $(doc).find('a').off('click').on('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();                    
    
                        var aHref = $(this).attr('href');
                        var combinedPath = aHref.match(/^#/) ? $iframe.attr('data-src').replace(/#.*$/, '') + aHref : Helpers.ResolveContentRef(aHref, $iframe.attr('data-src'));
                        var hashIndex = combinedPath.indexOf("#");
                        var hrefPart;
                        var elementId;
                        if (hashIndex >= 0) {
                            hrefPart = combinedPath.substr(0, hashIndex);
                            elementId = combinedPath.substr(hashIndex + 1);
                        }
                        else {
                            hrefPart = combinedPath;
                            elementId = undefined;
                        }
    
                        var linkSpineItem = readium.reader.spine().getItemByHref(hrefPart);
                        var bookmark = new BookmarkData(linkSpineItem.idref, null);
                        
                        bookmark.elementCfi = bookmark.contentCFI;
                        bookmark.contentCFI = undefined;
                        bookmark = JSON.stringify(bookmark);
                        
                        ebookURL = ensureUrlIsRelativeToApp(ebookURL);
    
                        var url = biblemesh_Helpers.buildUrlQueryParameters(undefined, {
                            epub: ebookURL,
                            goto: bookmark,
                            elementId: elementId
                        }, true);
    
                        window.open(url);
                    });
    
                    $(document.body).removeClass("widgetloading");
    
                    var spineInfo = biblemesh_spinelabels[spineItem.href.replace(/#.*$/,'')];
                    var spineLabel = $('<textarea />').html((spineInfo && spineInfo.hrefsAndLabels && spineInfo.hrefsAndLabels[0] && spineInfo.hrefsAndLabels[0].label) || "").text();
                    var title = $('<textarea />').html(biblemesh_widgetMetaData.title).text();
                    var author = $('<textarea />').html(biblemesh_widgetMetaData.author).text();
                    parent.postMessage({
                        action: 'setReference',
                        iframeid: window.name,
                        payload: {
                            spineLabel: spineLabel,
                            title: title,
                            author: author,
                        }
                    }, '*');
    
                    var docHt = $(doc).find('html').height();
                    parent.postMessage({
                        action: 'setHeight',
                        iframeid: window.name,
                        payload: docHt,
                    }, '*');
    
                    $('.content-doc-frame, #scaler').css('height', docHt);
       
                    spin(false);
                    $("#epub-reader-frame").css("opacity", "");
                }
    
                setTimeout(function() {
                    var urlParams = biblemesh_Helpers.getURLQueryParams();
                    if(!biblemesh_isWidget && urlParams.elementId) {
                        readium.reader.openSpineItemElementId(spineItem.idref, urlParams.elementId);
                    }
                }, 1);
            });
    
            readium.reader.on(ReadiumSDK.Events.PAGINATION_CHANGED, function (pageChangeData)
            {
                Globals.logEvent("PAGINATION_CHANGED", "ON", "EpubReader.js");

                // var biblemesh_isOnload = biblemesh_onload;  //first call to this function is always during onload
                // biblemesh_onload = false;
    
                // if(!biblemesh_isOnload) biblemesh_savePlace();
                updateUI(pageChangeData);
    
                if(pageChangeData.spineItem && !biblemesh_isWidget) {  // biblemesh_
                    spin(false);
                    $("#epub-reader-frame").css("opacity", "");
                }
    
                var bookmark = JSON.parse(readium.reader.bookmarkCurrentPage());
                biblemesh_currentLoadedPageBookmark = bookmark;

                biblemesh_getPagesInfoFunc && biblemesh_getPagesInfoFunc()

                biblemesh_AppComm.postMsg('pageChanged', {
                    newCfi: bookmark.contentCFI,
                    newSpineIdRef: bookmark.idref,
                });
    
            });
    
        } // end of loadToc
    
        var biblemesh_getHighlightDataObj = function(cfiObj) {
            var returnObj = false;
            var cfiObjId = biblemesh_getHighlightId(cfiObj);
    
            biblemesh_highlights.forEach(function(highlight, idx) {
                if(biblemesh_getHighlightId(highlight) == cfiObjId) {
                    returnObj = {
                        highlight: highlight,
                        idx: idx
                    };
                }
            });
    
            return returnObj;
        }
    
        var biblemesh_getHighlightId = function(highlight) {
            return (highlight.spineIdRef || highlight.idref) + ' ' + highlight.cfi;
        }
    
        var biblemesh_markHighlightsWithNotes = function() {
            var iframe = $("#epub-reader-frame iframe")[0];
            if(!iframe) return;
            var doc = ( iframe.contentWindow || iframe.contentDocument ).document;
            var docEl = $( doc.documentElement );
    
            docEl.children('.rd-highlight').removeClass('highlight-with-note');
    
            biblemesh_highlights.forEach(function(highlight) {
                if(highlight.hasNote) {
                    var highlightId = biblemesh_getHighlightId(highlight);
                    var highlightEl = docEl.children('[data-id="' + highlightId + '"]');
                    if(highlightEl) {
                        highlightEl.addClass('highlight-with-note');
                    }
                }
            });
        }
    
        var biblemesh_drawHighlights = function() {
            if (readium && readium.reader.plugins.highlights) {
    
                var bookmark = JSON.parse(readium.reader.bookmarkCurrentPage());
                var idRef = bookmark.idref;
                var highlightsToDraw = [];
    
                // next line needed especially for switching between books
                readium.reader.plugins.highlights.removeHighlightsByType("user-highlight");
    
                biblemesh_highlights.forEach(function(highlight) {
                    // without this line, highlights are sometimes not added because they are listed as still there
                    readium.reader.plugins.highlights.removeHighlight(biblemesh_getHighlightId(highlight));
                    if(highlight.spineIdRef == idRef && !highlight._delete) {
                        highlightsToDraw.push(highlight);
                    }
                });
    
                highlightsToDraw.sort(function(a, b) {
                    return biblemesh_contentCfiComparator(a.cfi, b.cfi);
                });
    
                highlightsToDraw.forEach(function(highlight) {
                    try {
                        readium.reader.plugins.highlights.addHighlight(
                            highlight.spineIdRef,
                            highlight.cfi,
                            biblemesh_getHighlightId(highlight),
                            "user-highlight"
                        );
                    } catch(e) {
                        // should never get here.
                    }
                });
                biblemesh_markHighlightsWithNotes();
            }
        }
        
        var updateUI = function(pageChangeData){
    
            // biblemesh_ : IF and ELSE block new
            if(pageChangeData.spineItem == undefined) {  // i.e. if they are on the same chapter
                try {
                    // quicker than running biblemesh_drawHighlights
                    // needed because highlights off screen when a new spine is loaded are not drawn
                    readium.reader.plugins.highlights.redrawAnnotations();
                    biblemesh_markHighlightsWithNotes();
                } catch(e) {}
            } else {
                biblemesh_drawHighlights();
            }
    
        }
    
        //copied from readium-js/readium-shared-js/plugins/highlights
        var biblemesh_parseContentCfi = function(cont) {
            return cont.replace(/\[(.*?)\]/, "").split(/[\/,:]/).map(function(n) {
                return parseInt(n);
            }).filter(Boolean);
        }
    
        //copied from readium-js/readium-shared-js/plugins/highlights
        var biblemesh_contentCfiComparator = function(cont1, cont2) {
            cont1 = biblemesh_parseContentCfi(cont1);
            cont2 = biblemesh_parseContentCfi(cont2);
    
            //compare cont arrays looking for differences
            for (var i = 0; i < cont1.length; i++) {
                if (cont1[i] > cont2[i]) {
                    return 1;
                } else if (cont1[i] < cont2[i]) {
                    return -1;
                }
            }
    
            //no differences found, so confirm that cont2 did not have values we didn't check
            if (cont1.length < cont2.length) {
                return -1;
            }
    
            //cont arrays are identical
            return 0;
        }
    
        var biblemesh_getBookmarkURL = function(){
            if (!ebookURL) return;
            
            var bookmark = readium.reader.bookmarkCurrentPage();
            bookmark = JSON.parse(bookmark);
            
            var cfi = new BookmarkData(bookmark.idref, bookmark.contentCFI);
            
            bookmark.elementCfi = bookmark.contentCFI;
            bookmark.contentCFI = undefined;
            bookmark = JSON.stringify(bookmark);
            
            ebookURL = ensureUrlIsRelativeToApp(ebookURL);
    
            var url = biblemesh_Helpers.buildUrlQueryParameters(undefined, {
                epub: ebookURL,
                epubs: " ",
                embedded: " ",
                goto: bookmark
            });
    
            return url;
        }
    
        var biblemesh_showHighlightOptions = function(forceShowNote) {

            var iframe = $("#epub-reader-frame iframe")[0];
            var win = iframe.contentWindow || iframe;
            var doc = ( iframe.contentWindow || iframe.contentDocument ).document;
            var docEl = $( doc.documentElement );
            var sel = win.getSelection();
            var selStr = sel.toString().replace(/\n/g,' ').trim();
            var cfiObj = readium.reader.plugins.highlights.getCurrentSelectionCfi();
    
            if(!sel.isCollapsed && selStr!='' && cfiObj) {
    
                var highlightId = biblemesh_getHighlightId(cfiObj);
                    
                var currentHighlight = biblemesh_getHighlightDataObj(cfiObj);
                
                var hasCurrentHighlight = function() {
                    return currentHighlight && !currentHighlight.highlight._delete;
                }
    
                // get selection bounding box
                var rg = sel.getRangeAt(0);
                var cRect = rg.getBoundingClientRect();
                var selectionVeryTop = cRect.top;
                var selectionVeryBottom = cRect.top+cRect.height;
                var winHt = $(win).height()

                var tooltipHt = 30  // TODO: needs to be adjusted; likely differs between android and ios

                var tooltipAboveText =
                    (selectionVeryTop - tooltipHt) > 0
                    || (selectionVeryBottom + tooltipHt) > winHt
                var copyTooltipInLowerHalf = tooltipAboveText
                    ? (selectionVeryTop - tooltipHt) > (winHt / 2)
                    : (selectionVeryBottom + tooltipHt) > (winHt / 2)

                biblemesh_AppComm.postMsg('textSelected', {
                    text: selStr,
                    spineIdRef: cfiObj.idref,
                    cfi: cfiObj.cfi,
                    copyTooltipInLowerHalf: copyTooltipInLowerHalf,
                });
                biblemesh_textSelected = true
                
            } else {
                biblemesh_AppComm.postMsg('textUnselected');
                biblemesh_textSelected = false
            }
        }
    
        var loadReaderUIPrivate = function(){
            var $appContainer = $('#app-container');
            $appContainer.empty();
            // $appContainer.append(ReaderBody({strings: Strings, dialogs: Dialogs, keyboard: Keyboard}));
            $appContainer.append(ReaderBody());
    
            spin(true);
        }
    
        var loadReaderUI = function (data) {
            ebookURL = data.epub;
            ebookURL_filepath = Helpers.getEbookUrlFilePath(ebookURL);
            biblemesh_isWidget = !!data.widget;
    
            if(biblemesh_isWidget) {
                parent.postMessage({
                    action: 'loading',
                    iframeid: window.name
                }, '*');
            }
    
            loadReaderUIPrivate();
    
            //because we reinitialize the reader we have to unsubscribe to all events for the previews reader instance
            if(readium && readium.reader) {
                
                Globals.logEvent("__ALL__", "OFF", "EpubReader.js");
                readium.reader.off();
            }
    
            if (window.ReadiumSDK) {
                Globals.logEvent("PLUGINS_LOADED", "OFF", "EpubReader.js");
                ReadiumSDK.off(ReadiumSDK.Events.PLUGINS_LOADED);
            }
    
            setTimeout(function()
            {
                initReadium(); //async
            }, 0);
        };

        var biblemesh_translateSettings = function(settings) {
            settings.syntheticSpread = settings.columns;
            settings.fontSize = settings.textSize;
        }
    
        var initReadium = function(){

            biblemesh_highlights = window.initialHighlightsObjFromWebView || biblemesh_highlights;
            delete window.initialHighlightsObjFromWebView;

            var spotInfo = biblemesh_Helpers.getCurrentSpotInfo(); // biblemesh_
    
            try { ga('send', 'pageview', window.location.pathname); } catch(e) {} // biblemesh_
    
            var readerOptions =  {
                el: "#epub-reader-frame",
                annotationCSSUrl: moduleConfig.annotationCSSUrl + '?bust=VERSION_BUST_STRING',  // biblemesh_
                mathJaxUrl : moduleConfig.mathJaxUrl,
            };
    
            var readiumOptions = {
                jsLibRoot: moduleConfig.jsLibRoot,
                openBookOptions: {}
            };
    
            if (moduleConfig.useSimpleLoader){
                readiumOptions.useSimpleLoader = true;
            }
    
            var openPageRequest;
            var goto = spotInfo.ebookSpot;  //biblemesh_
            if (goto) {
                console.log("Goto override? " + goto);
    
                try {
                    var gotoObj = JSON.parse(goto);
                    
                    var openPageRequest_ = undefined;
                    
                    
                    // See ReaderView.openBook()
                    // e.g. with accessible_epub_3:
                    // &goto={"contentRefUrl":"ch02.xhtml%23_data_integrity","sourceFileHref":"EPUB"}
                    // or: {"idref":"id-id2635343","elementCfi":"/4/2[building_a_better_epub]@0:10"} (the legacy spatial bookmark is wrong here, but this is fixed in intel-cfi-improvement feature branch)
                    if (gotoObj.idref) {
                        if (gotoObj.spineItemPageIndex) {
                            openPageRequest_ = {idref: gotoObj.idref, spineItemPageIndex: gotoObj.spineItemPageIndex};
                        }
                        else if (gotoObj.elementCfi) {
                                        
                            openPageRequest_ = {idref: gotoObj.idref, elementCfi: gotoObj.elementCfi};
                        }
                        else {
                            openPageRequest_ = {idref: gotoObj.idref};
                        }
                    }
                    else if (gotoObj.contentRefUrl && gotoObj.sourceFileHref) {
                        openPageRequest_ = {contentRefUrl: gotoObj.contentRefUrl, sourceFileHref: gotoObj.sourceFileHref};
                    }
                    
                    
                    if (openPageRequest_) {
                        if(biblemesh_isWidget) {
                            biblemesh_isWidget = openPageRequest_;
                        }
                        openPageRequest = openPageRequest_;
                        console.debug("Open request (goto): " + JSON.stringify(openPageRequest));
                    }
                } catch(err) {
                    console.error(err);
                }
            }
            readium = new Readium(readiumOptions, readerOptions);
    
            window.READIUM = readium;
    
            ReadiumSDK.on(ReadiumSDK.Events.PLUGINS_LOADED, function () {
                Globals.logEvent("PLUGINS_LOADED", "ON", "EpubReader.js");
                
                console.log('PLUGINS INITIALIZED!');
    
                if (!readium.reader.plugins.highlights) {
                    $('.icon-annotations').css("display", "none");
                } else {
                    $('.icon-annotations').css("display", "none");  // biblemesh_ 
    
                    readium.reader.plugins.highlights.initialize({
                        annotationCSSUrl: readerOptions.annotationCSSUrl
                    });
    
                    readium.reader.plugins.highlights.on("annotationTouched", function(type, idref, cfi, id) {
                        biblemesh_highlightTouched = true;
                    });

                    readium.reader.plugins.highlights.on("annotationClicked", function(type, idref, cfi, id) {
                        console.debug("ANNOTATION CLICK: " + id);
                        // biblemesh_ : this function has all new contents

                        if(biblemesh_preventAnnotationClick) return;

                        var iframe = $("#epub-reader-frame iframe")[0];
                        var win = iframe.contentWindow || iframe;
                        var sel = win.getSelection();
    
                        // select the text of a highlight
                        var highlightBookmarkData = new BookmarkData(idref, cfi);
                        var highlightRange = readium.reader.getDomRangeFromRangeCfi(highlightBookmarkData);
    
                        sel.removeAllRanges();
                        sel.addRange(highlightRange);
        
                    });
                }
    
            });
    
            readium.reader.addIFrameEventListener('keydown', function(e) {
                e.preventDefault();
                e.stopPropagation();
            });
    
            var docEl, touchPageX, touchPageY, touchIsClick, touchIsSwipe,
                docElLeftBeforeStart, touchPageXAtStart, touchPageXOnLastMove,
                touchPageXOnSecondToLastMove, timeAtStart, timeOnLastMove, timeOnSecondToLastMove,
                isTransitioning, textWasSelectedAtStart;

            var wrapInTransition = function(action, transitionTime, postAction) {
                var gracePeriodToFinish = Math.min(transitionTime / 2, 100);
                isTransitioning = true;
                docEl.css("transition", "left " + (transitionTime / 1000) + "s linear");
                requestAnimationFrame(action);
                setTimeout(function() {
                    docEl.css("transition", "");
                    postAction && postAction();
                    isTransitioning = false;
                }, transitionTime + gracePeriodToFinish);
            }
        
            var cancelSwipe = function(transitionTime) {
                touchIsClick = touchIsSwipe = false;

                // bring back to original position
                wrapInTransition(function() {
                    docEl.css('left', docElLeftBeforeStart + 'px');
                }, transitionTime || 200);
            }

            var pageExistsToThe = function(direction) {
                // logic taken from reader_view.js

                var spine = readium.reader.spine();
                var paginationInfo = readium.reader.getPaginationInfo();
                var isNext = direction === 'Left';
                if(spine.isLeftToRight()) isNext = !isNext;

                if(isNext) {

                    if (paginationInfo.openPages.length == 0) {
                        return false;
                    }
            
                    var lastOpenPage = paginationInfo.openPages[paginationInfo.openPages.length - 1];
            
                    if (lastOpenPage.spineItemPageIndex < lastOpenPage.spineItemPageCount - 1) {
                        return 'same spine';
                    }
            
                    var currentSpineItem = spine.getItemById(lastOpenPage.idref);
                    var nextSpineItem = spine.nextItem(currentSpineItem);
            
                    return nextSpineItem ? 'new spine' : false;

                } else {
                    
                    if (paginationInfo.openPages.length == 0) {
                        return false;
                    }
            
                    var firstOpenPage = paginationInfo.openPages[0];
            
                    if (firstOpenPage.spineItemPageIndex > 0) {
                        return 'same spine';
                    }
            
                    var currentSpineItem = spine.getItemById(firstOpenPage.idref);
                    var prevSpineItem = spine.prevItem(currentSpineItem);
            
                    return prevSpineItem ? 'new spine' : false;
                }            
            }

            readium.reader.addIFrameEventListener('touchstart', function(e) {
                if(isTransitioning) return;
                if(e.touches.length !== 1) {
                    cancelSwipe();
                    return;
                }

                var iframe = $("#epub-reader-frame iframe")[0];
                var doc = ( iframe.contentWindow || iframe.contentDocument ).document;
                docEl = $( doc.documentElement );

                textWasSelectedAtStart = biblemesh_textSelected;
                touchPageXAtStart = touchPageXOnLastMove = touchPageX = e.touches[0].pageX;
                touchPageY = e.touches[0].pageY;
                touchIsClick = true;
                touchIsSwipe = false;
                docElLeftBeforeStart = parseInt(docEl.css('left'), 10);
                timeAtStart = timeOnLastMove = Date.now();
            }, 'document');

            readium.reader.addIFrameEventListener('touchmove', function(e) {
                if(isTransitioning) return;
                if(e.touches.length !== 1) return;

                if(touchIsClick) {
                    touchIsClick = Math.sqrt((touchPageX - e.touches[0].pageX) * 2 + (touchPageY - e.touches[0].pageY) * 2) < 4;
                    touchIsSwipe = !touchIsClick;
                }
                
                if(touchIsSwipe) {
                    touchPageXOnSecondToLastMove = touchPageXOnLastMove;
                    timeOnSecondToLastMove = timeOnLastMove;
                    touchPageXOnLastMove = e.touches[0].pageX;
                    timeOnLastMove = Date.now();
                    docEl.css('left', (docElLeftBeforeStart + (touchPageXOnLastMove - touchPageXAtStart)) + 'px');
                }
            }, 'document');
            
            readium.reader.addIFrameEventListener('touchend', function(e) {
                if(isTransitioning) return;
                if(e.touches.length !== 0) return;

                if(touchIsClick) {

                    if(textWasSelectedAtStart) {
                        biblemesh_AppComm.postMsg('textUnselected');
                        biblemesh_textSelected = false
                    }

                    if(
                        !textWasSelectedAtStart
                        && !biblemesh_highlightTouched
                        && Date.now() - timeAtStart < 500   // long touches should not be considered page turn taps
                        && !$(e.target || document.body).closest('a, [onclick], [onmousedown], [ontouchstart]')[0]  // it is a link/clickable, or is inside a link/clickable
                    ) {

                        var winWd = window.innerWidth;
                        var pageToDirection = '';

                        if(touchPageX / winWd < .3) {
                            pageToDirection = 'Left';
                        }

                        if(touchPageX / winWd > .7) {
                            pageToDirection = 'Right';
                        }

                        if(pageToDirection) {
                            var existsPageInDesiredDirection = pageExistsToThe(pageToDirection);
                            if(existsPageInDesiredDirection) {
                                var pageWidth = $("#epub-reader-frame iframe").width();
                                wrapInTransition(
                                    function() {
                                        docEl.css('left', (docElLeftBeforeStart + pageWidth * (pageToDirection === 'Left' ? 1 : -1)) + 'px')
                                    },
                                    250,
                                    readium.reader['openPage' + pageToDirection]
                                );
                            } else {
                                wrapInTransition(
                                    function() {
                                        var shakeAdjAmount = (pageToDirection === 'Left' ? 100 : -100);
                                        docEl.css('left', (docElLeftBeforeStart + shakeAdjAmount) + 'px');
                                        setTimeout(function() { docEl.css('left', (docElLeftBeforeStart - shakeAdjAmount) + 'px'); }, 50);
                                        setTimeout(function() { cancelSwipe(50); }, 100);
                                    },
                                    200
                                );
                            }
                        } else {
                            biblemesh_AppComm.postMsg('showPageListView');
                        }
                    
                    }

                } else if(touchIsSwipe) {

                    var direction = touchPageXAtStart < touchPageXOnLastMove ? 'Left' : 'Right';
                    var lastDirection = touchPageXOnSecondToLastMove < touchPageXOnLastMove ? 'Left' : 'Right';

                    var lastSpeed = Math.abs(touchPageXOnLastMove - touchPageXOnSecondToLastMove) / (timeOnLastMove - timeOnSecondToLastMove);  // px/ms
                    var pageWidth = $("#epub-reader-frame iframe").width();
                    var dragLength = Math.abs(parseInt(docEl.css('left'), 10) - docElLeftBeforeStart);
                    var speedToPxFactor = 900;
                    var existsPageInDesiredDirection = pageExistsToThe(direction);
            
                    if(
                        (direction === lastDirection || lastSpeed < .2)
                        && lastSpeed * speedToPxFactor + dragLength > pageWidth / 2
                        && existsPageInDesiredDirection
                    ) {
                        var transitionTime = (pageWidth - dragLength) / Math.max(lastSpeed, .8);
                        wrapInTransition(
                            function() {
                                docEl.css('left', (docElLeftBeforeStart + pageWidth * (direction === 'Left' ? 1 : -1)) + 'px')
                            },
                            transitionTime,
                            readium.reader['openPage' + direction]
                        );

                        // unselect text
                        if(biblemesh_isMobileSafari) {
                            biblemesh_AppComm.postMsg('textUnselected');
                            biblemesh_textSelected = textWasSelectedAtStart;
                        } else {
                            var iframe = $("#epub-reader-frame iframe")[0];
                            var win = iframe.contentWindow || iframe;
                            var sel = win.getSelection();
                            sel.removeAllRanges();
                        }
                                
                    } else {
                        cancelSwipe();
                    }

                    // prevent annotation click to fire after this
                    biblemesh_preventAnnotationClick = true;
                    setTimeout(function() { biblemesh_preventAnnotationClick = false; }, 300)

                }

                biblemesh_highlightTouched = touchIsClick = touchIsSwipe = false;

            }, 'document');

            readium.reader.addIFrameEventListener('selectionchange', biblemesh_showHighlightOptions, 'document');
    
            var defaultSettings = {
                fontSize: 100,
                syntheticSpread: "auto",
                scroll: "auto",
                theme: "author-theme",
                columnGap: 60,
                columnMaxWidth: 1000,
                columnMinWidth: 300
            }
    
            if(biblemesh_isWidget) {
                var urlParams = biblemesh_Helpers.getURLQueryParams();
                defaultSettings.scroll = 'scroll-doc';
                defaultSettings.theme = urlParams.theme || 'author-theme'; 
                defaultSettings.columnMaxWidth = 99999;
                defaultSettings.columnMinWidth = 100;
                defaultSettings.syntheticSpread = 'single';
                defaultSettings.fontSize = parseInt(urlParams.textsize, 10) || 100;
            }

            biblemesh_translateSettings(spotInfo.settings);

            var readerSettings = Object.assign(defaultSettings, spotInfo.settings);   // biblemesh_

            readium.reader.updateSettings(readerSettings);
            
            readium.reader.on(ReadiumSDK.Events.CONTENT_DOCUMENT_LOAD_START, function($iframe, spineItem) {
                Globals.logEvent("CONTENT_DOCUMENT_LOAD_START", "ON", "EpubReader.js [ " + spineItem.href + " ]");
    
                $("#epub-reader-frame").css("opacity", ".01");
                spin(true);
            });
    
            EpubReaderMediaOverlays.init(readium);
    
            EpubReaderBackgroundAudioTrack.init(readium);
    
            //epubReadingSystem
    
            loadEbook(openPageRequest);

            biblemesh_AppComm.subscribe('goToCfi', function(payload) {
                try {
                    readium.reader.openSpineItemElementCfi(payload.spineIdRef, payload.cfi);
                } catch(e) {
                    biblemesh_AppComm.postMsg('reportError', { errorCode: 'invalid cfi' });
                }
            });

            biblemesh_AppComm.subscribe('goToHref', function(payload) {
                try {
                    var spineItem = readium.reader.spine().getItemByHref(payload.href);
                    var hrefUri = new URI(payload.href);
                    var hashFrag = hrefUri.fragment();
                    readium.reader.openSpineItemElementId(spineItem.idref, hashFrag);
                } catch(e) {
                    biblemesh_AppComm.postMsg('reportError', { errorCode: 'invalid href' });
                }
            });

            biblemesh_AppComm.subscribe('goToPage', function(payload) {

                var bookmark = JSON.parse(readium.reader.bookmarkCurrentPage());
                
                if(bookmark.idref == payload.spineIdRef) {
                    readium.reader.openPageIndex(payload.pageIndexInSpine);
                } else {
                    readium.reader.openSpineItemPage(payload.spineIdRef, payload.pageIndexInSpine);
                }
            });

            biblemesh_AppComm.subscribe('loadSpineAndGetPagesInfo', function(payload) {

                biblemesh_getPagesInfoFunc = function() {
                    var $iframe = $("#epub-reader-frame iframe");
                        
                    if(!biblemesh_currentLoadedPageBookmark) return  // this will be null if the initial load is not finished
                    
                    if(biblemesh_currentLoadedPageBookmark.idref == payload.spineIdRef) {
                        biblemesh_getPagesInfoFunc = undefined;

                        var numPages = readium.reader.biblemesh_getColumnCount();

                        var width = $iframe.width() * numPages;
                        window.biblemesh_preventAllResizing = true;
                        $iframe.css("width", width);
                        $(document.body).css("width", width);

                        var pageCfis = [];
                        for(var pageIndex=0; pageIndex<numPages; pageIndex++) {
                            var cfi = readium.reader.biblemesh_getFirstVisibleCfiOnSpineItemPageIndex(pageIndex);
                            pageCfis.push(cfi);
                        }

                        biblemesh_AppComm.postMsg('pagesInfo', {
                            spineIdRef: payload.spineIdRef,
                            pageCfis: pageCfis,
                        });

                    } else {
                        readium.reader.openSpineItemElementId(payload.spineIdRef);
                    }
                }
                
            });

            biblemesh_AppComm.subscribe('renderHighlights', function(payload) {
                biblemesh_highlights = payload.highlights;
                biblemesh_drawHighlights();
            });

            biblemesh_AppComm.subscribe('setDisplaySettings', function(payload) {
                biblemesh_translateSettings(payload);
                readium.reader.updateSettings(payload);
            });

            biblemesh_AppComm.subscribe('setSelectionText', function(payload) {
                var iframe = $("#epub-reader-frame iframe")[0];
                var win = iframe.contentWindow || iframe;
                var sel = win.getSelection();
                var textSelectedBefore = biblemesh_textSelected

                if(!payload || !payload.spineIdRef || !payload.cfi) {
                    sel.removeAllRanges();
                    biblemesh_textSelected = false;
                    return;
                }

                // select the text of a highlight
                var highlightBookmarkData = new BookmarkData(payload.spineIdRef, payload.cfi);
                var highlightRange = readium.reader.getDomRangeFromRangeCfi(highlightBookmarkData);

                sel.removeAllRanges();
                sel.addRange(highlightRange);

                if(biblemesh_isMobileSafari) {
                    biblemesh_textSelected = textSelectedBefore
                }

            });

            biblemesh_AppComm.postMsg('loaded');

        }
    
        var unloadReaderUI = function(){
    
            if (readium) {
                readium.closePackageDocument();
            }
    
            // visibility check fails because iframe is unloaded
            //if (readium.reader.isMediaOverlayAvailable())
            if (readium && readium.reader) // window.push/popstate
            {
                try{
                    readium.reader.pauseMediaOverlay();
                }catch(err){
                    //ignore error.
                    //can occur when ReaderView._mediaOverlayPlayer is null, for example when openBook() fails 
                }
            }
    
            // $(window).off('unload');  // biblemesh_
        }
    
        var applyKeyboardSettingsAndLoadUi = function(data)
        {
            // override current scheme with user options
            Settings.get('reader', function(json)
            {
                loadReaderUI(data);
            });
        };
    
        return {
            loadUI : applyKeyboardSettingsAndLoadUi,
            unloadUI : unloadReaderUI,
            tooltipSelector : function() {},
            ensureUrlIsRelativeToApp : ensureUrlIsRelativeToApp 
        };
    
    });
        