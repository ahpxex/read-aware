// MCP Bridge: Enables eval() contexts to communicate with Tauri IPC
// This bridge is automatically injected by the mcp-bridge plugin
// It forwards DOM events from eval() contexts to Tauri IPC and back

(function() {
   'use strict';

   var ipcMonitorEnabled = false,
       originalInvoke = null,
       origLog, origDebug, origInfo, origWarn, origError, bridgeLogger;

   // MCP bridge logger - scoped with levels and tags
   function createMcpLogger(scope) {
      return {
         info: function() {
            var args = Array.prototype.slice.call(arguments);

            args.unshift('[MCP][' + scope + '][INFO]');
            console.log.apply(console, args);
         },
         warn: function() {
            var args = Array.prototype.slice.call(arguments);

            args.unshift('[MCP][' + scope + '][WARN]');
            console.warn.apply(console, args);
         },
         error: function() {
            var args = Array.prototype.slice.call(arguments);

            args.unshift('[MCP][' + scope + '][ERROR]');
            console.error.apply(console, args);
         },
         tag: function(tag, message) {
            console.error('[MCP][' + scope + '][' + tag + ']', message);
         },
      };
   }

   bridgeLogger = createMcpLogger('BRIDGE');

   // Initialize console capture so logs are captured from app startup
   function initConsoleCapture() {
      var args, message;

      if (window.__MCP_CONSOLE_LOGS__) {
         return; // Already initialized
      }

      origLog = console.log;
      origDebug = console.debug;
      origInfo = console.info;
      origWarn = console.warn;
      origError = console.error;

      window.__MCP_CONSOLE_LOGS__ = [];

      function captureLog(level, origFn) {
         return function() {
            args = Array.prototype.slice.call(arguments);

            message = args
               .map(function(a) {
                  if (typeof a !== 'object' || a === null) {
                     return String(a);
                  }
                  try {
                     return JSON.stringify(a);
                  } catch(_) {
                     // JSON.stringify fails on circular references or
                     // null-prototype objects.
                     // Values cannot be serialized — listing keys only.
                     return '[non-serializable, keys only: ' + Object.keys(a).join(', ') + ']';
                  }
               })
               .join(' ');

            window.__MCP_CONSOLE_LOGS__.push({
               level: level,
               message: message,
               timestamp: Date.now(),
            });

            origFn.apply(console, args);
         };
      }

      console.log = captureLog('log', origLog);
      console.debug = captureLog('debug', origDebug);
      console.info = captureLog('info', origInfo);
      console.warn = captureLog('warn', origWarn);
      console.error = captureLog('error', origError);

      bridgeLogger.info('Console capture initialized');
   }

   // Wait for Tauri API to be available
   function waitForTauri(callback) {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
         // eslint-disable-next-line callback-return
         callback();
      } else {
         setTimeout(function() {
            waitForTauri(callback);
         }, 50);
      }
   }

   // =========================================================================
   // IPC Monitoring
   // =========================================================================

   function reportAround(originalFn, thisArg, cmd, args) {
      var startTime = Date.now();

      function reportEvent(result, error, duration) {
         var reportPromise;

         if (!originalInvoke) {
            return;
         }

         // Skip reporting bridge-internal commands to avoid noise
         if (typeof cmd === 'string' && cmd.startsWith('plugin:mcp-bridge|')) {
            return;
         }

         reportPromise = originalInvoke('plugin:mcp-bridge|report_ipc_event', {
            command: cmd,
            args: args || {},
            result: result,
            error: error,
            durationMs: duration,
         });

         reportPromise.catch(function() {
            // Ignore errors from reporting
         });
      }

      return originalFn.apply(thisArg, [ cmd, args ])
         .then(function(result) {
            reportEvent(result, null, Date.now() - startTime);
            return result;
         })
         .catch(function(error) {
            reportEvent(null, error.message || String(error), Date.now() - startTime);
            throw error;
         });
   }

   /**
     * Enables IPC monitoring by replacing the Tauri core object.
     * Called from Rust via execute_js when start_ipc_monitor is invoked.
     *
     * Note: window.__TAURI__.core.invoke is read-only in Tauri v2, so we replace
     * the entire core object with a new one that wraps invoke.
     */
   window.__MCP_START_IPC_MONITOR__ = function() {
      var originalCore, wrappedInvoke;

      if (ipcMonitorEnabled) {
         return;
      }

      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
         bridgeLogger.error('Cannot start IPC monitor: Tauri API not available');
         return;
      }

      originalCore = window.__TAURI__.core;
      originalInvoke = originalCore.invoke;
      ipcMonitorEnabled = true;

      wrappedInvoke = function(cmd, args) {
         return reportAround(originalInvoke, this, cmd, args);
      };

      // Create a new core object with all original properties plus wrapped invoke
      window.__TAURI__.core = Object.assign({}, originalCore, { invoke: wrappedInvoke });

      bridgeLogger.info('IPC monitoring started');
   };

   /**
     * Disables IPC monitoring and restores the original core object.
     * Called from Rust via execute_js when stop_ipc_monitor is invoked.
     */
   window.__MCP_STOP_IPC_MONITOR__ = function() {
      if (!ipcMonitorEnabled || !originalInvoke) {
         return;
      }

      // Restore original invoke by creating a new core object
      window.__TAURI__.core = Object.assign({}, window.__TAURI__.core, { invoke: originalInvoke });
      originalInvoke = null;

      ipcMonitorEnabled = false;

      bridgeLogger.info('IPC monitoring stopped');
   };

   // =========================================================================
   // Element Picker Shared Helpers
   // =========================================================================

   /**
    * Generates a unique CSS selector for a given element by traversing up the DOM.
    * @param {Element} el
    * @returns {string}
    */
   function generateUniqueSelector(el) {
      var parts = [],
          current = el,
          part, parent, siblings, index, totalSameTag, i;

      while (current && current !== document.documentElement) {
         if (current.id) {
            parts.unshift('#' + current.id);
            break;
         }

         part = current.tagName.toLowerCase();
         parent = current.parentElement;

         if (parent) {
            siblings = parent.children;
            index = 0;

            for (i = 0; i < siblings.length; i += 1) {
               if (siblings[i].tagName === current.tagName) {
                  index += 1;
               }
               if (siblings[i] === current) {
                  break;
               }
            }

            // Only add nth-of-type if there are multiple siblings of the same tag
            totalSameTag = 0;

            for (i = 0; i < siblings.length; i += 1) {
               if (siblings[i].tagName === current.tagName) {
                  totalSameTag += 1;
               }
            }

            if (totalSameTag > 1) {
               part += ':nth-of-type(' + index + ')';
            }
         }

         parts.unshift(part);
         current = parent;
      }

      return parts.join(' > ');
   }

   /**
    * Generates an XPath for a given element. More robust than CSS selectors for
    * uniquely identifying elements in the DOM tree.
    * @param {Element} el
    * @returns {string}
    */
   function generateXPath(el) {
      var nodeElem = el,
          parts = [],
          nbOfPreviousSiblings, hasNextSiblings, sibling, prefix, nth;

      while (nodeElem && nodeElem.nodeType === 1) { // ELEMENT_NODE
         if (nodeElem.id) {
            parts.unshift('*[@id="' + nodeElem.id + '"]');
            break;
         }

         nbOfPreviousSiblings = 0;
         hasNextSiblings = false;

         sibling = nodeElem.previousSibling;
         while (sibling) {
            if (sibling.nodeType !== 10 && sibling.nodeName === nodeElem.nodeName) { // not DOCUMENT_TYPE_NODE
               nbOfPreviousSiblings += 1;
            }
            sibling = sibling.previousSibling;
         }

         sibling = nodeElem.nextSibling;
         while (sibling) {
            if (sibling.nodeName === nodeElem.nodeName) {
               hasNextSiblings = true;
               break;
            }
            sibling = sibling.nextSibling;
         }

         prefix = nodeElem.prefix ? nodeElem.prefix + ':' : '';
         nth = (nbOfPreviousSiblings || hasNextSiblings)
            ? '[' + (nbOfPreviousSiblings + 1) + ']'
            : '';

         parts.unshift(prefix + nodeElem.localName + nth);
         nodeElem = nodeElem.parentElement;
      }

      return parts.length ? '/' + parts.join('/') : '';
   }

   /**
    * Finds the best element at a given point, filtering out SVG internals and
    * MCP picker UI elements. Uses elementsFromPoint for more robust detection.
    * @param {number} x
    * @param {number} y
    * @returns {Element|null}
    */
   function getElementAtPoint(x, y) {
      var elements, i, el, rect;

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
         return null;
      }

      elements = document.elementsFromPoint(x, y);

      for (i = 0; i < elements.length; i++) {
         el = elements[i];

         // Skip SVG internal elements (lines, paths, rects inside SVGs)
         if (el.closest && el.closest('svg') && el.tagName.toLowerCase() !== 'svg') {
            continue;
         }

         // Skip picker UI elements
         if (el.getAttribute && el.getAttribute('data-mcp-picker')) {
            continue;
         }
         if (el.closest && el.closest('[data-mcp-picker]')) {
            continue;
         }

         // Verify the element is actually at the point via bounding rect
         rect = el.getBoundingClientRect();
         if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return el;
         }
      }

      return null;
   }

   /**
    * Collects rich metadata about a DOM element.
    * @param {Element} el
    * @returns {Object}
    */
   function collectElementMetadata(el) {
      var rect = el.getBoundingClientRect(),
          cs = window.getComputedStyle(el),
          attrs = {},
          styleProps, computedStyles, parentChain, ancestor, ancestorRect, parentInfo, textContent,
          i, attr;

      for (i = 0; i < el.attributes.length; i += 1) {
         attr = el.attributes[i];
         attrs[attr.name] = attr.value;
      }

      styleProps = [
         'display', 'position', 'visibility', 'opacity',
         'color', 'background-color', 'font-size', 'font-family',
         'padding', 'margin', 'border', 'width', 'height',
         'z-index', 'overflow',
      ];
      computedStyles = {};

      for (i = 0; i < styleProps.length; i += 1) {
         computedStyles[styleProps[i]] = cs.getPropertyValue(styleProps[i]);
      }

      // Build structured parent chain (richer than just string descriptors)
      parentChain = [];
      ancestor = el.parentElement;

      while (ancestor && ancestor !== document.documentElement && parentChain.length < 5) {
         ancestorRect = ancestor.getBoundingClientRect();
         parentInfo = {
            tag: ancestor.tagName.toLowerCase(),
            id: ancestor.id || null,
            classes: ancestor.className && typeof ancestor.className === 'string'
               ? ancestor.className.trim().split(/\s+/).filter(Boolean)
               : [],
            boundingRect: {
               x: ancestorRect.x,
               y: ancestorRect.y,
               width: ancestorRect.width,
               height: ancestorRect.height,
            },
         };

         parentChain.push(parentInfo);
         ancestor = ancestor.parentElement;
      }

      textContent = (el.textContent || '').trim();

      if (textContent.length > 500) {
         textContent = textContent.substring(0, 500) + '...';
      }

      return {
         tag: el.tagName.toLowerCase(),
         id: el.id || null,
         classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [],
         attributes: attrs,
         textContent: textContent,
         boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
         },
         cssSelector: generateUniqueSelector(el),
         xpath: generateXPath(el),
         computedStyles: computedStyles,
         parentChain: parentChain,
         timestamp: Date.now(),
      };
   }

   // Expose helpers on window for reuse by element-picker.js
   window.__MCP_COLLECT_ELEMENT_METADATA__ = collectElementMetadata;
   window.__MCP_GENERATE_SELECTOR__ = generateUniqueSelector;
   window.__MCP_GET_ELEMENT_AT_POINT__ = getElementAtPoint;

   waitForTauri(function() {
      bridgeLogger.info('Tauri API available, initializing bridge');

      // Initialize console capture immediately so logs are captured from the start
      initConsoleCapture();

      // Capture unhandled JS errors and promise rejections while preserving
      // default behavior
      if (!window.__MCP_UNHANDLED_ERRORS_CAPTURED__) {
         window.__MCP_UNHANDLED_ERRORS_CAPTURED__ = true;

         window.addEventListener('error', function(event) {
            var message, source, line;

            try {
               message = event.message || 'Unhandled error';
               source = event.filename ? ' at ' + event.filename : '';
               line = typeof event.lineno === 'number' ? ':' + event.lineno : '';

               bridgeLogger.tag('UNHANDLED_ERROR', message + source + line);
            } catch(e) {
               // Best-effort logging; do not interfere with default handling
            }
         });

         window.addEventListener('unhandledrejection', function(event) {
            var reason, reasonMessage;

            try {
               reason = event.reason;

               if (reason && typeof reason === 'object') {
                  if (reason instanceof Error && reason.message) {
                     reasonMessage = reason.message;
                  } else {
                     try {
                        reasonMessage = JSON.stringify(reason);
                     } catch(e) {
                        reasonMessage = String(reason);
                     }
                  }
               } else {
                  reasonMessage = String(reason);
               }

               bridgeLogger.tag('UNHANDLED_REJECTION', reasonMessage);
            } catch(e) {
               // Best-effort logging; do not interfere with default handling
            }
         });
      }

      // =====================================================================
      // User-initiated element pointing (Alt+Shift+Click)
      // =====================================================================
      document.addEventListener('click', function(e) {
         var el, metadata, flashDiv;

         if (!e.altKey || !e.shiftKey) {
            return;
         }

         e.preventDefault();
         e.stopPropagation();

         el = e.target;

         if (!el || el.nodeType !== 1) {
            return;
         }

         metadata = collectElementMetadata(el);
         window.__MCP_POINTED_ELEMENT__ = metadata;

         // Visual flash feedback (green border, fades out)
         flashDiv = document.createElement('div');
         flashDiv.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;' +
            'border:3px solid #22C55E;background:rgba(34,197,94,0.1);transition:opacity 0.5s;' +
            'top:' + metadata.boundingRect.top + 'px;' +
            'left:' + metadata.boundingRect.left + 'px;' +
            'width:' + metadata.boundingRect.width + 'px;' +
            'height:' + metadata.boundingRect.height + 'px;';
         document.body.appendChild(flashDiv);

         setTimeout(function() {
            flashDiv.style.opacity = '0';
         }, 1000);
         setTimeout(function() {
            if (flashDiv.parentNode) {
               flashDiv.parentNode.removeChild(flashDiv);
            }
         }, 1500);

         // Emit Tauri event for the Rust forwarder
         if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
            window.__TAURI__.event.emit('__element_pointed', metadata);
         }

         bridgeLogger.info('Element pointed via Alt+Shift+Click:', metadata.cssSelector);
      }, true);

      // Listen for execution requests from eval() contexts
      window.addEventListener('__mcp_exec_request', async function(event) {
         const request = event.detail;

         bridgeLogger.info('Received request:', request);

         try {
            // Forward to Tauri IPC using the global API
            const result = await window.__TAURI__.core.invoke(
               request.command,
               request.args
            );

            bridgeLogger.info('Command succeeded, sending response');

            // Send success response back via DOM event
            window.dispatchEvent(new CustomEvent('__mcp_exec_response', {
               detail: {
                  execId: request.execId,
                  success: true,
                  data: result,
               },
            }));
         } catch(error) {
            bridgeLogger.error('Command failed:', error);

            // Send error response back via DOM event
            window.dispatchEvent(new CustomEvent('__mcp_exec_response', {
               detail: {
                  execId: request.execId,
                  success: false,
                  error: error.message || String(error),
               },
            }));
         }
      });

      // Mark bridge as ready
      window.__MCP_BRIDGE_READY__ = true;
      bridgeLogger.info('Ready');

      // Notify Rust that the page has loaded and scripts should be re-injected
      // This is called after the bridge is ready to ensure Tauri IPC is available
      notifyPageLoaded();
   });

   // =========================================================================
   // Script Injection Functions
   // =========================================================================

   /**
    * Injects scripts into the DOM. Called by Rust when scripts need to be injected.
    * @param {Array<{id: string, type: 'inline'|'url', content: string}>} scripts
    */
   window.__MCP_INJECT_SCRIPTS__ = function(scripts) {
      var script;

      if (!Array.isArray(scripts)) {
         bridgeLogger.error('Invalid scripts array');
         return;
      }

      scripts.forEach(function(entry) {
         if (!entry || !entry.id) {
            return;
         }

         // Check if script already exists
         if (document.querySelector('script[data-mcp-script-id="' + entry.id + '"]')) {
            bridgeLogger.info('Script already exists:', entry.id);
            return;
         }

         script = document.createElement('script');

         script.setAttribute('data-mcp-script-id', entry.id);

         if (entry.type === 'url') {
            script.src = entry.content;
            script.async = true;
            script.onload = function() {
               bridgeLogger.info('URL script loaded:', entry.id);
            };
            script.onerror = function() {
               bridgeLogger.error('Failed to load URL script:', entry.id);
            };
         } else {
            // Inline script
            script.textContent = entry.content;
         }

         document.head.appendChild(script);
         bridgeLogger.info('Injected script:', entry.id);
      });
   };

   /**
    * Removes a script from the DOM by ID.
    * @param {string} scriptId
    */
   window.__MCP_REMOVE_SCRIPT__ = function(scriptId) {
      var script = document.querySelector('script[data-mcp-script-id="' + scriptId + '"]');

      if (script) {
         script.remove();
         bridgeLogger.info('Removed script:', scriptId);
      }
   };

   /**
    * Removes all MCP-managed scripts from the DOM.
    */
   window.__MCP_CLEAR_SCRIPTS__ = function() {
      var scripts = document.querySelectorAll('script[data-mcp-script-id]');

      scripts.forEach(function(s) {
         s.remove();
      });
      bridgeLogger.info('Cleared', scripts.length, 'scripts');
   };

   /**
    * Notifies Rust that the page has loaded and scripts should be re-injected.
    * Uses the Tauri event system to communicate with the plugin.
    */
   function notifyPageLoaded() {
      // Use Tauri's invoke to request script re-injection.
      // The plugin responds by calling __MCP_INJECT_SCRIPTS__ with registered scripts.
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
         window.__TAURI__.core.invoke('plugin:mcp-bridge|request_script_injection')
            .catch(function(err) {
               // This command may not exist in older versions, which is fine
               bridgeLogger.warn('Script injection request:', err.message || 'not available');
            });
      }
   }

   // Also listen for navigation events to re-inject scripts
   // This handles SPA-style navigation where the page doesn't fully reload
   window.addEventListener('popstate', function() {
      bridgeLogger.info('Navigation detected (popstate)');
      notifyPageLoaded();
   });
}());
