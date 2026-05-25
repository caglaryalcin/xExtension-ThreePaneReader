(function() {
    'use strict';
    console.log("Inoreader FreshRSS extension detected");

    // Reveal the reading area once the layout is ready (see the on-load flash CSS rule).
    var reveal = function() {
        document.documentElement.classList.add("inoreader-ready");
    };

    // CSP-safe styling: a page CSP such as "default-src 'self'" blocks inline <style> elements
    // and style attributes (style-src-elem / style-src-attr) — even an *empty* <style> element
    // is reported (its hash is the empty-string hash). Constructable stylesheets are applied
    // purely through the CSSOM and are not subject to style-src, so we route all of this
    // extension's dynamic CSS through one and avoid creating any <style> node at all.
    var makeSheet = function() {
        try {
            var sheet = new CSSStyleSheet();
            document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
            return sheet;
        } catch (e) {
            return null;
        }
    };

    // Kill the on-load flash as early as possible: if this script runs while the page is
    // still parsing (in <head>), hide the reading area before first paint. reveal() drops
    // it once the panes are built.
    if (document.readyState === "loading") {
        var foucSheet = makeSheet();
        if (foucSheet) {
            try {
                foucSheet.replaceSync(
                    "html:not(.inoreader-ready) #stream," +
                    "html:not(.inoreader-ready) #inoreadercontainer{visibility:hidden!important}");
            } catch (e) {}
        }
    }

    var _started = false;
    var _load = function()
    {
        if (_started)
            return;

        if (!window.context || typeof init_stream !== "function") {
            console.log("Inoreader FreshRSS extension waiting for FreshRSS to be initialized");
            window.setTimeout(_load, 100);
            return;
        }

        _started = true;

        // Remove the "My labels" (#tags) section from the sidebar entirely.
        var tagsSection = document.getElementById("tags");
        if (tagsSection)
            tagsSection.remove();

        // Only enable for normal display mode
        if (window.context.current_view !== "normal" || window.innerWidth < 800) {
            reveal();
            return;
        }

        var stream = document.getElementById("stream");
        var content = stream.querySelector(".flux.current");
        var html = content ? content.querySelector(".flux_content").innerHTML : "";
        stream.insertAdjacentHTML("beforebegin", `<div id="inoreadercontainer"></div>`);
        var wrapper = document.getElementById("inoreadercontainer");
        wrapper.appendChild(stream);
        wrapper.insertAdjacentHTML("beforeend", `<div id="inoreader"><div class="flux">${html}</div></div>`);

        // Set event listeners on the new panel (ex: click events to display labels, etc.)
        init_stream(document.getElementById("inoreader"));

        // The document will not receive scroll events anymore (since the height equals 100%), so we
        // set the stream node as the bow to follow and we re-dispatch it to the window.
        box_to_follow = document.getElementById("stream");
        document.getElementById("stream").addEventListener("scroll", function(event) {
            window.dispatchEvent(new UIEvent(event.type, event))
        });

        var _resize = function()
        {
            var topOffset = wrapper.offsetTop;

            // Some CSS is not loaded yet
            if (topOffset > 500)
                window.setTimeout(_resize, 10);
            else
            {
                var availableHeight = window.innerHeight - topOffset;
                wrapper.style.height = `${availableHeight}px`;

                // Also set the height for the menu.
                var menuForm = document.getElementById("mark-read-aside");
                var navEntries = document.getElementById("nav_entries");

                if (menuForm)
                    availableHeight -= menuForm.previousElementSibling.clientHeight;

                // Might not exist on the labels view for ex.
                if (navEntries)
                    availableHeight -= navEntries.clientHeight;

                menuForm.style.height = `${availableHeight}px`;
            }

        };
        _resize();
        window.addEventListener("resize", _resize);

        var panel = document.getElementById("inoreader");
        var panelContent = panel.querySelector(".flux");

        // Per-article skin colors are applied through a constructable stylesheet (see makeSheet)
        // rather than an inline <style> block inside the panel HTML, which a page CSP such as
        // "default-src 'self'" would block. replaceSync swaps in the current article's rule.
        var articleSheet = makeSheet();
        var setArticleStyle = function(articleId, styles)
        {
            if (!articleSheet)
                return;

            try {
                // Use "!important" since some themes use it… Also prefix with the article id
                // since scoped styles are not supported by every browser.
                articleSheet.replaceSync(
                    "#inoreader > #" + articleId + ", #inoreader > #" + articleId + ":hover {" +
                    "background-color: " + styles.backgroundColor + " !important;" +
                    "background-image: " + styles.backgroundImage + " !important;" +
                    "color: " + styles.color + " !important; }");
            } catch (e) {}
        };

        // Some feeds — and FreshRSS full-text retrieval — keep lazy-loaded images as a blank
        // placeholder in src (a data: URI sized like the real image) with the real URL in
        // data-src/data-srcset. FreshRSS doesn't run the site's lazy-load script, so the
        // placeholder renders as an empty box (the "extra white space"). Promote the real
        // source so the image actually shows.
        var fixLazyImages = function(root)
        {
            if (!root)
                return;

            // Build the set of real srcs already shown by non-lazy images. Sites like
            // mariushosting emit each image twice: a <noscript> copy with the real src (which
            // FreshRSS keeps, unwrapped) plus a lazy <img> with a blank placeholder src and the
            // real URL in data-src. Promoting the lazy one too would duplicate the image, so we
            // drop the lazy copy whenever a non-lazy twin already shows the same URL.
            var shown = {};
            root.querySelectorAll("img:not([data-src])").forEach(function(img) {
                var s = img.getAttribute("src");
                if (s && s.lastIndexOf("data:", 0) !== 0)
                    shown[s] = true;
            });

            root.querySelectorAll("img[data-src]").forEach(function(img) {
                var realSrc = img.getAttribute("data-src");
                if (!realSrc)
                    return;

                // Already displayed by a non-lazy twin → this lazy copy is a duplicate.
                if (shown[realSrc]) {
                    img.remove();
                    return;
                }

                // No twin → promote the real source so the image renders.
                img.setAttribute("src", realSrc);

                var realSrcset = img.getAttribute("data-srcset");
                if (realSrcset)
                    img.setAttribute("srcset", realSrcset);

                var realSizes = img.getAttribute("data-sizes");
                if (realSizes)
                    img.setAttribute("sizes", realSizes);

                img.removeAttribute("data-src");
                img.removeAttribute("data-srcset");
                img.removeAttribute("data-sizes");

                // Remember it so a later lazy copy of the same image is de-duplicated too.
                shown[realSrc] = true;
            });
        };

        // With "Mark article as read on open" enabled, FreshRSS runs mark_read() on the article
        // *just before* it dispatches the openArticle event (see toggleContent): the article's
        // read icons are swapped to a spinner first, then we copy that article into the panel —
        // so the panel inherits a frozen spinner <img>. The real spinner lives on the source row
        // in #stream and is cleared there ~1s later when the batched request resolves, but the
        // panel's copy is a different DOM node that nothing ever clears, so it spins forever.
        // Restore any copied spinner to its resolved icon. Auto-mark only fires for unread→read
        // transitions, so a copied read-toggle spinner always resolves to the "read" icon.
        var clearCopiedSpinners = function(root)
        {
            if (!root || !window.context || !context.icons)
                return;

            root.querySelectorAll("a.read > .icon.spinner").forEach(function(icon) {
                icon.outerHTML = context.icons.read;
            });

            // Anything else still spinning (e.g. a favourite toggle mid-flight): at least stop
            // the animation so it can't hang the panel.
            root.querySelectorAll(".icon.spinner").forEach(function(icon) {
                icon.classList.remove("spinner");
            });
        };

        var setContent = function(html, articleId)
        {
            // Check the container has the expected height (which can sometimes be removed by
            //something else).
            if (!(wrapper.getAttribute("style") || "").includes("height"))
                _resize();

            panelContent.innerHTML = html;

            // Resolve lazy-loaded images so they render instead of leaving blank placeholders.
            fixLazyImages(panelContent);

            // Drop any in-flight mark-as-read spinner that was copied in with the article.
            clearCopiedSpinners(panelContent);

            // Duplicate the id attribute so that it can be retrieve by other functions
            panelContent.setAttribute("id", articleId);

            // Scroll to top of panel
            panel.scrollTop = 0;
        };

        var onArticleOpened = function(articleElement) {
            // Make the new article visible if out of scroll.
            articleElement.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                scrollMode: "if-needed"
            });

            var articleId = articleElement.getAttribute("id");

            // Header element and its attributes must also be copied for the share button to work.
            var articleHeaderElement = articleElement.querySelector(".flux_header");
            var articleContentElement = articleElement.querySelector(".flux_content");

            // outerHTML does not copy the data-* attributes.
            var articleHeaderDatasetAttributes = "";
            for (var ds in articleHeaderElement.dataset) {
                articleHeaderDatasetAttributes += `ds="${articleHeaderElement.dataset[ds]}" `
            }

            var actualArticleHeader = articleHeaderElement.outerHTML.replace('>', `${articleHeaderDatasetAttributes}>`);
            var actualArticleContent = articleContentElement.innerHTML;

            // Each skin might have a different background color for the content than the #global
            // node which is the parent they share with this extension container.
            // As  we want to keep the same display, we need to copy it.
            var contentStyles = window.getComputedStyle(articleElement);

            setContent(`${actualArticleHeader}
            ${actualArticleContent}
            `, articleId);

            // Apply the copied skin colors via the CSSOM (see setArticleStyle) so the page CSP
            // does not block them. setContent has just set panelContent's id to articleId, so
            // the "#inoreader > #articleId" selector matches the article that is now shown.
            setArticleStyle(articleId, contentStyles);

            // We need to replace every id (and reference to it) by a new one to avoid duplicates.
            panelContent.querySelectorAll("[id]").forEach(function(node) {
                let ref = node.getAttribute("id");

                if (!ref)
                    return;

                let newRef = `3panes-${ref}`;

                // Set a new id value.
                node.setAttribute("id", newRef);

                // Update all references to it.
                panelContent.querySelectorAll(`[href="#${ref}"]`).forEach(function(elt) {
                    elt.setAttribute("href", `#${newRef}`);
                });
            });
        };

        document.addEventListener('freshrss:openArticle', function(event) {
            onArticleOpened(event.target);
        });

        stream.addEventListener("click", function(event) {
            // Open external links in the 3rd pane too.
            if (event.target.matches(".flux li.link *") && !event.ctrlKey)
            {
                event.preventDefault();

                var link = event.target.closest("a");
                var url = link ? link.getAttribute("href") : "";
                if (url) {
                    setContent(`<iframe src="${url}"></iframe>`);
                }

                return;
            }

            // Legacy: deal with older FreshRSS versions without 'openArticle' event.
            // Do not use `window.freshrssOpenArticleEvent`, it is not available on `window` since
            // https://github.com/FreshRSS/FreshRSS/commit/b438d8bb3d4b3dea6d28d0b0c73da9393c9d8299#diff-86db6bc50f24e839f927bdd2262ce6d58c450fb23b13f8e9e5501b047add9bba
            if (typeof freshrssOpenArticleEvent === "undefined") {
                var closestArticle = event.target.closest(".flux");

                if (closestArticle && stream.contains(closestArticle))
                    onArticleOpened(closestArticle);
            }
        });

        // ---- 3rd-pane read / favorite toggles ----------------------------------
        // The article-content panel (#inoreader) is a *copy* of the open article and is given
        // the same id="flux_<id>" as the matching row in the list (#stream) so FreshRSS helpers
        // can find it. But two elements then share one id, and document.getElementById() — used
        // by FreshRSS to clear the spinner after mark_read()/mark_favorite() resolve — can only
        // return one: the list row, which comes first in the DOM. So when a toggle is clicked in
        // the panel, FreshRSS puts the spinner on the *panel's* icon yet resolves the request
        // against the *list row*, leaving the panel's spinner to spin forever. (The request
        // itself succeeds in a few ms, which is why the Network tab shows nothing in flight.)
        //
        // Fix: intercept read/favorite clicks inside the panel and run the action against the
        // real, unique list row instead (correct not_read state too), then mirror the resulting
        // icon/state back into the panel once FreshRSS finishes its async DOM update.
        var inoOriginalOnclick = panel.onclick;
        panel.onclick = function(ev) {
            var actionLink = ev.target.closest(".flux a.read, .flux a.bookmark");
            if (actionLink) {
                var panelFlux = actionLink.closest(".flux");
                var fluxId = panelFlux ? panelFlux.getAttribute("id") : null;
                // Scope the lookup to #stream so we always get the list row, never the panel copy.
                var listItem = fluxId ? stream.querySelector("#" + fluxId) : null;
                if (listItem && listItem !== panelFlux) {
                    var selector = actionLink.matches("a.bookmark") ? "a.bookmark" : "a.read";
                    var listLink = listItem.querySelector(selector);
                    if (listLink) {
                        // Let FreshRSS handle the toggle on the correct element…
                        listLink.click();

                        // …then copy the resolved icon + unread class back into the panel once
                        // FreshRSS's async success handler has updated the list row.
                        var mirror = function() {
                            var src = listItem.querySelector(selector);
                            var dst = panelFlux.querySelector(selector);
                            if (src && dst)
                                dst.innerHTML = src.innerHTML;
                            panelFlux.classList.toggle("not_read", listItem.classList.contains("not_read"));
                        };
                        if (window.MutationObserver) {
                            var obs = new MutationObserver(mirror);
                            obs.observe(listItem, { subtree: true, childList: true,
                                attributes: true, attributeFilter: ["class", "src"] });
                            window.setTimeout(function() { obs.disconnect(); }, 5000);
                        } else {
                            window.setTimeout(mirror, 100);
                        }
                        return false;
                    }
                }
            }
            if (inoOriginalOnclick)
                return inoOriginalOnclick.call(this, ev);
        };
        // ------------------------------------------------------------------------

        // ---- Resizable dividers -------------------------------------------------
        // Two draggable splitters that can be grabbed anywhere along their height:
        //   * left:  between the navigation sidebar and the articles list
        //   * right: between the articles list and the article content (#inoreader)
        (function setupSplitters() {
            var splitters = [];

            // Persist the divider widths so they survive a page reload/restart.
            var STORE_KEY = "inoreader.sizes";
            var loadSizes = function() {
                try {
                    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
                } catch (e) {
                    return {};
                }
            };
            var saveSize = function(key, value) {
                var sizes = loadSizes();
                sizes[key] = value;
                try {
                    localStorage.setItem(STORE_KEY, JSON.stringify(sizes));
                } catch (e) {}
            };
            var savedSizes = loadSizes();

            var repositionAll = function() {
                splitters.forEach(function(s) { s(); });
            };

            // Find the navigation sidebar robustly across themes / FreshRSS versions.
            var findSidebar = function() {
                var known = document.querySelector(".aside.aside_feed, #aside_feed, .aside_feed, #sidebar, nav#sidebar, .aside");
                if (known)
                    return known;

                // Fallback: closest aside/nav sibling found while walking up from the container.
                var node = wrapper;
                while (node && node !== document.body) {
                    var sib = node.previousElementSibling;
                    while (sib) {
                        if (sib.tagName === "ASIDE" || sib.tagName === "NAV" ||
                            /(^|[\s#.])(aside|sidebar)/i.test(" " + sib.id + " " + sib.className))
                            return sib;
                        sib = sib.previousElementSibling;
                    }
                    node = node.parentElement;
                }

                return document.querySelector("aside");
            };

            // Create a splitter pinned to the right edge of `leftPane`.
            // `onResize(newWidthPx)` is called while dragging with the requested width.
            var addSplitter = function(leftPane, onResize, onCommit) {
                if (!leftPane)
                    return;

                var handle = document.createElement("div");
                handle.className = "inoreader-splitter";
                document.body.appendChild(handle);

                var reposition = function() {
                    var r = leftPane.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) {
                        handle.style.display = "none";
                        return;
                    }
                    handle.style.display = "block";
                    handle.style.top = r.top + "px";
                    handle.style.height = r.height + "px";
                    handle.style.left = (r.right - (handle.offsetWidth / 2)) + "px";
                };

                handle.addEventListener("pointerdown", function(event) {
                    event.preventDefault();
                    handle.setPointerCapture(event.pointerId);
                    document.body.classList.add("inoreader-resizing");

                    var paneLeft = leftPane.getBoundingClientRect().left;

                    var onMove = function(ev) {
                        onResize(ev.clientX - paneLeft);
                        repositionAll();
                    };

                    var onUp = function() {
                        document.body.classList.remove("inoreader-resizing");
                        handle.releasePointerCapture(event.pointerId);
                        handle.removeEventListener("pointermove", onMove);
                        handle.removeEventListener("pointerup", onUp);
                        reposition();
                        if (onCommit)
                            onCommit();
                    };

                    handle.addEventListener("pointermove", onMove);
                    handle.addEventListener("pointerup", onUp);
                });

                splitters.push(reposition);
                reposition();
            };

            // Right divider: resize the articles list inside the flex container and let
            // #inoreader fill the remaining space so there is never any overflow.
            // Measure the default (50/50) list width BEFORE changing the flex values, so the
            // divider keeps its original centred starting position.
            // Below this list width the date overlaps the title, so we hide the title
            // (see the #stream.inoreader-narrow rule in the CSS). Tune to taste.
            var NARROW_THRESHOLD = 300;
            var setStreamWidth = function(newWidth) {
                var total = wrapper.getBoundingClientRect().width;
                newWidth = Math.max(150, Math.min(newWidth, total - 150));
                stream.style.setProperty("flex", "0 0 " + newWidth + "px", "important");
                stream.style.setProperty("width", newWidth + "px", "important");
                stream.classList.toggle("inoreader-narrow", newWidth < NARROW_THRESHOLD);
                return newWidth;
            };

            var initStreamWidth = stream.getBoundingClientRect().width ||
                (wrapper.getBoundingClientRect().width / 2);
            panel.style.setProperty("flex", "1 1 0", "important");
            panel.style.setProperty("width", "auto", "important");
            // Restore the saved list width, falling back to the default centred position.
            setStreamWidth(savedSizes.stream || initStreamWidth);

            var streamWidth;
            addSplitter(stream, function(newWidth) {
                streamWidth = setStreamWidth(newWidth);
            }, function() {
                if (streamWidth != null)
                    saveSize("stream", streamWidth);
            });

            // Left divider: resize the navigation sidebar.
            var sidebar = findSidebar();
            console.log("Inoreader: sidebar detected for left divider =", sidebar,
                "| parent display =", sidebar ? getComputedStyle(sidebar.parentElement).display : "n/a");

            if (sidebar) {
                var setSidebarWidth = function(newWidth) {
                    newWidth = Math.max(120, Math.min(newWidth, window.innerWidth * 0.6));
                    sidebar.style.setProperty("width", newWidth + "px", "important");
                    sidebar.style.setProperty("min-width", newWidth + "px", "important");
                    sidebar.style.setProperty("max-width", newWidth + "px", "important");
                    sidebar.style.setProperty("flex", "0 0 " + newWidth + "px", "important");

                    var parent = sidebar.parentElement;
                    if (parent && getComputedStyle(parent).display.indexOf("grid") !== -1)
                        parent.style.setProperty("grid-template-columns", newWidth + "px 1fr", "important");
                    return newWidth;
                };

                // Restore the saved sidebar width on load.
                if (savedSizes.sidebar)
                    setSidebarWidth(savedSizes.sidebar);

                var sidebarWidth;
                addSplitter(sidebar, function(newWidth) {
                    sidebarWidth = setSidebarWidth(newWidth);
                }, function() {
                    if (sidebarWidth != null)
                        saveSize("sidebar", sidebarWidth);
                });
            }

            // Keep the handles glued to the panes when sizes change.
            window.addEventListener("resize", repositionAll);
            if (window.ResizeObserver) {
                var ro = new ResizeObserver(repositionAll);
                ro.observe(wrapper);
                ro.observe(stream);
                if (sidebar)
                    ro.observe(sidebar);
            }
            // Reposition once more after the layout settles (heights set by _resize, fonts, etc.).
            window.setTimeout(repositionAll, 50);
            window.setTimeout(repositionAll, 300);
        })();
        // ------------------------------------------------------------------------

        // ---- Relative dates (1h, 5h, 1d, 5d…) in the articles list -------------
        var relativeTime = function(date) {
            var s = Math.max(0, (Date.now() - date.getTime()) / 1000);
            if (s < 60)  return Math.floor(s) + "s";
            var m = s / 60;
            if (m < 60)  return Math.floor(m) + "m";
            var h = m / 60;
            if (h < 24)  return Math.floor(h) + "h";
            var d = h / 24;
            if (d < 7)   return Math.floor(d) + "d";
            var w = d / 7;
            if (w < 5)   return Math.floor(w) + "w";
            var mo = d / 30;
            if (mo < 12) return Math.floor(mo) + "mo";
            return Math.floor(d / 365) + "y";
        };

        var refreshDate = function(t) {
            var d = new Date(t.getAttribute("datetime"));
            if (isNaN(d.getTime()))
                return;

            // Keep the original full date as a hover tooltip (stored once).
            if (!t.dataset.inoFull) {
                t.dataset.inoFull = (t.textContent || "").trim();
                if (t.dataset.inoFull && !t.title)
                    t.title = t.dataset.inoFull;
            }

            t.textContent = relativeTime(d);
        };

        var formatDates = function(root) {
            if (!root)
                return;
            if (root.matches && root.matches("time[datetime]"))
                refreshDate(root);
            if (root.querySelectorAll)
                root.querySelectorAll("time[datetime]").forEach(refreshDate);
        };

        formatDates(stream);

        // Keep the labels current and convert articles added by infinite scroll.
        window.setInterval(function() { formatDates(stream); }, 60000);
        if (window.MutationObserver) {
            new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(function(n) {
                        if (n.nodeType === 1)
                            formatDates(n);
                    });
                });
            }).observe(stream, { childList: true, subtree: true });
        }
        // ------------------------------------------------------------------------

        // Fix lazy-loaded images in the article shown in the panel on first load (later
        // articles go through setContent, which already calls fixLazyImages).
        fixLazyImages(panelContent);

        // Same for a copied-in spinner on the first article (later articles go through setContent).
        clearCopiedSpinners(panelContent);

        reveal();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _load);
    } else {
        _load();
    }
}());
