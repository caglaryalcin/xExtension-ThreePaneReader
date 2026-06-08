(function() {
    'use strict';
    console.log("Inoreader FreshRSS extension detected");

    var reveal = function() {
        document.documentElement.classList.add("inoreader-ready");
    };

    var makeSheet = function() {
        try {
            var sheet = new CSSStyleSheet();
            document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
            return sheet;
        } catch (e) {
            return null;
        }
    };

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

        var tagsSection = document.getElementById("tags");
        if (tagsSection)
            tagsSection.remove();

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

        init_stream(document.getElementById("inoreader"));

        box_to_follow = document.getElementById("stream");
        document.getElementById("stream").addEventListener("scroll", function(event) {
            window.dispatchEvent(new UIEvent(event.type, event))
        });

        var _resize = function()
        {
            var topOffset = wrapper.offsetTop;

            if (topOffset > 500)
                window.setTimeout(_resize, 10);
            else
            {
                var availableHeight = window.innerHeight - topOffset;
                wrapper.style.height = `${availableHeight}px`;

                var menuForm = document.getElementById("mark-read-aside");
                var navEntries = document.getElementById("nav_entries");

                if (menuForm)
                    availableHeight -= menuForm.previousElementSibling.clientHeight;

                if (navEntries)
                    availableHeight -= navEntries.clientHeight;

                menuForm.style.height = `${availableHeight}px`;
            }

        };
        _resize();
        window.addEventListener("resize", _resize);

        var panel = document.getElementById("inoreader");
        var panelContent = panel.querySelector(".flux");

        var articleSheet = makeSheet();
        var setArticleStyle = function(articleId, styles)
        {
            if (!articleSheet)
                return;

            try {
                articleSheet.replaceSync(
                    "#inoreader > #" + articleId + ", #inoreader > #" + articleId + ":hover {" +
                    "background-color: " + styles.backgroundColor + " !important;" +
                    "background-image: " + styles.backgroundImage + " !important;" +
                    "color: " + styles.color + " !important; }");
            } catch (e) {}
        };

        var fixLazyImages = function(root)
        {
            if (!root)
                return;

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

                if (shown[realSrc]) {
                    img.remove();
                    return;
                }

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

                shown[realSrc] = true;
            });
        };

        var clearCopiedSpinners = function(root)
        {
            if (!root || !window.context || !context.icons)
                return;

            root.querySelectorAll("a.read > .icon.spinner").forEach(function(icon) {
                icon.outerHTML = context.icons.read;
            });

            root.querySelectorAll(".icon.spinner").forEach(function(icon) {
                icon.classList.remove("spinner");
            });
        };

        var setContent = function(html, articleId)
        {
            if (!(wrapper.getAttribute("style") || "").includes("height"))
                _resize();

            panelContent.innerHTML = html;

            fixLazyImages(panelContent);

            clearCopiedSpinners(panelContent);

            panelContent.setAttribute("id", articleId);

            panel.scrollTop = 0;
        };

        var onArticleOpened = function(articleElement) {
            articleElement.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                scrollMode: "if-needed"
            });

            var articleId = articleElement.getAttribute("id");

            var articleHeaderElement = articleElement.querySelector(".flux_header");
            var articleContentElement = articleElement.querySelector(".flux_content");

            var articleHeaderDatasetAttributes = "";
            for (var ds in articleHeaderElement.dataset) {
                articleHeaderDatasetAttributes += `ds="${articleHeaderElement.dataset[ds]}" `
            }

            var actualArticleHeader = articleHeaderElement.outerHTML.replace('>', `${articleHeaderDatasetAttributes}>`);
            var actualArticleContent = articleContentElement.innerHTML;

            var contentStyles = window.getComputedStyle(articleElement);

            setContent(`${actualArticleHeader}
            ${actualArticleContent}
            `, articleId);

            setArticleStyle(articleId, contentStyles);

            panelContent.querySelectorAll("[id]").forEach(function(node) {
                let ref = node.getAttribute("id");

                if (!ref)
                    return;

                let newRef = `3panes-${ref}`;

                node.setAttribute("id", newRef);

                panelContent.querySelectorAll(`[href="#${ref}"]`).forEach(function(elt) {
                    elt.setAttribute("href", `#${newRef}`);
                });
            });
        };

        document.addEventListener('freshrss:openArticle', function(event) {
            onArticleOpened(event.target);
        });

        stream.addEventListener("click", function(event) {
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

            if (typeof freshrssOpenArticleEvent === "undefined") {
                var closestArticle = event.target.closest(".flux");

                if (closestArticle && stream.contains(closestArticle))
                    onArticleOpened(closestArticle);
            }
        });

        var inoOriginalOnclick = panel.onclick;
        panel.onclick = function(ev) {
            var actionLink = ev.target.closest(".flux a.read, .flux a.bookmark");
            if (actionLink) {
                var panelFlux = actionLink.closest(".flux");
                var fluxId = panelFlux ? panelFlux.getAttribute("id") : null;
                var listItem = fluxId ? stream.querySelector("#" + fluxId) : null;
                if (listItem && listItem !== panelFlux) {
                    var selector = actionLink.matches("a.bookmark") ? "a.bookmark" : "a.read";
                    var listLink = listItem.querySelector(selector);
                    if (listLink) {
                        listLink.click();

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

        (function setupSplitters() {
            var splitters = [];

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

            var findSidebar = function() {
                var known = document.querySelector(".aside.aside_feed, #aside_feed, .aside_feed, #sidebar, nav#sidebar, .aside");
                if (known)
                    return known;

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
            setStreamWidth(savedSizes.stream || initStreamWidth);

            var streamWidth;
            addSplitter(stream, function(newWidth) {
                streamWidth = setStreamWidth(newWidth);
            }, function() {
                if (streamWidth != null)
                    saveSize("stream", streamWidth);
            });

            var sidebar = findSidebar();

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

            window.addEventListener("resize", repositionAll);
            if (window.ResizeObserver) {
                var ro = new ResizeObserver(repositionAll);
                ro.observe(wrapper);
                ro.observe(stream);
                if (sidebar)
                    ro.observe(sidebar);
            }
            window.setTimeout(repositionAll, 50);
            window.setTimeout(repositionAll, 300);
        })();

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

        var addThumbnails = function(root) {
            if (!root) return;

            var articles = [];
            if (root.matches && root.matches(".flux")) {
                articles = [root];
            } else if (root.querySelectorAll) {
                articles = root.querySelectorAll(".flux");
            }

            articles.forEach(function(article) {
                var header = article.querySelector(".flux_header");
                var content = article.querySelector(".flux_content");

                if (!header || !content) return;

                var existingThumb = header.querySelector(".item.thumbnail");
                if (existingThumb && existingThumb.querySelector("img")) {
                    return;
                }

                var validSrc = null;
                var images = content.querySelectorAll("img");

                for (var i = 0; i < images.length; i++) {
                    var img = images[i];
                    
                    if (img.classList.contains("favicon") || img.classList.contains("icon") || img.classList.contains("spinner")) {
                        continue;
                    }

                    var src = img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || img.src || img.getAttribute("src") || "";
                    
                    if (!src) continue;

                    var lowerSrc = src.toLowerCase();
                    if (lowerSrc.includes("feedburner") || lowerSrc.includes("pixel") || lowerSrc.includes("tracker") || lowerSrc.includes("grey.gif") || lowerSrc.includes("themes/icons/") || lowerSrc.includes("loading") || lowerSrc.indexOf("data:image") === 0) {
                        continue;
                    }

                    var w = img.getAttribute("width");
                    var h = img.getAttribute("height");
                    if (w === "1" || h === "1" || w === "0" || h === "0") {
                        continue;
                    }

                    validSrc = src;
                    break;
                }

                if (!validSrc) {
                    var links = content.querySelectorAll("a[href]");
                    for (var j = 0; j < links.length; j++) {
                        var href = links[j].getAttribute("href") || "";
                        var lowerHref = href.toLowerCase();
                        if (lowerHref.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/)) {
                            validSrc = href;
                            break;
                        }
                    }
                }

                if (existingThumb) {
                    if (validSrc) {
                        var thumbImg = document.createElement("img");
                        thumbImg.src = validSrc;
                        thumbImg.setAttribute("onerror", "this.style.display='none'");
                        existingThumb.appendChild(thumbImg);
                    }
                } else {
                    var thumbDiv = document.createElement("div");
                    thumbDiv.className = "item thumbnail";

                    if (validSrc) {
                        var thumbImg = document.createElement("img");
                        thumbImg.src = validSrc;
                        thumbImg.setAttribute("onerror", "this.style.display='none'");
                        thumbDiv.appendChild(thumbImg);
                    }

                    header.insertBefore(thumbDiv, header.firstChild);
                }
            });
        };

        formatDates(stream);
        addThumbnails(stream);

        window.setInterval(function() { formatDates(stream); }, 60000);
        if (window.MutationObserver) {
            new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(function(n) {
                        if (n.nodeType === 1) {
                            formatDates(n);
                            addThumbnails(n);
                        }
                    });
                });
            }).observe(stream, { childList: true, subtree: true });
        }

        fixLazyImages(panelContent);
        clearCopiedSpinners(panelContent);

        reveal();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _load);
    } else {
        _load();
    }
}());