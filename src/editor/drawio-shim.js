/**
 * Shim for the bundled draw.io editor (simnv-drawiomap-panel). webpack.config.ts copies this file to
 * dist/drawio/js/dmap-shim.js. The srcdoc document loads it before js/bootstrap.js. A plain script: it runs in the
 * draw.io frame, not in the plugin bundle.
 *
 * The editor frame is an iframe sandbox without allow-same-origin, so the document has an opaque origin. Grafana
 * sends no CORS headers, so XHR from the frame to the plugin files fails. scripts/vendor-drawio.sh converts the text
 * files that draw.io loads by XHR to script files (<file>.js calls dmapVfs.put) and lists them in
 * window.DMAP_VFS_FILES (js/PreConfig.js). For a GET of a listed file, this shim loads the script file and finishes
 * the XHR with the text, without a network request. Other requests do not change.
 *
 * The shim also opens the channel to the host (src/editor/protocol.ts, acceptChannelHello): it sends one hello with
 * the token of <meta name="dmap-channel"> and transfers a MessagePort. draw.io sends its messages with
 * (window.opener || window.parent).postMessage(msg, '*') and accepts messages whose source is that window.
 * window.parent is replaceable, so the shim sets it to the port: draw.io then talks only through the channel.
 *
 * Export: draw.io embeds images as data: URLs (embedImages). It cannot read image files of dist/drawio (no CORS), so
 * js/PostConfig.js calls dmapAfterApp(), which makes Editor.convertImageToDataUri ask the host for these files through
 * the channel (src/editor/files.ts).
 *
 * Input: Safari on macOS sends a quick two-finger tap as a right press without a release. The shim adds the release
 * (watchRightRelease), so draw.io opens its menu and does not pan the canvas.
 */
(function () {
  const base = document.baseURI;
  const nonce = document.currentScript != null ? document.currentScript.nonce : '';
  const files = {};
  const waiting = {};

  window.dmapVfs = {
    put: function (path, text) {
      files[path] = text;
    },
  };

  function isListed(path) {
    const list = window.DMAP_VFS_FILES || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] === path) {
        return true;
      }
    }
    return false;
  }

  /** Path of a listed file relative to <base>, or null. */
  function vfsPath(method, url) {
    if (String(method).toUpperCase() !== 'GET') {
      return null;
    }
    let href;
    try {
      href = new URL(url, base).href;
    } catch (e) {
      return null;
    }
    if (href.indexOf(base) !== 0) {
      return null;
    }
    const path = href.substring(base.length).split(/[?#]/)[0];
    return isListed(path) ? path : null;
  }

  function load(path, done) {
    if (files[path] != null) {
      done();
      return;
    }
    if (waiting[path] != null) {
      waiting[path].push(done);
      return;
    }
    waiting[path] = [done];
    const s = document.createElement('script');
    if (nonce) {
      s.nonce = nonce;
    }
    s.onload = s.onerror = function () {
      const callbacks = waiting[path];
      delete waiting[path];
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i]();
      }
    };
    s.src = path + '.js';
    document.head.appendChild(s);
  }

  /**
   * Finishes a request for a listed file without a network request: the instance gets the properties of a finished
   * GET, then the events. A real request cannot work: Grafana sends no CORS headers, and with
   * content_security_policy = true the inherited Grafana policy (connect-src) also blocks blob: and data: URLs.
   */
  function answer(xhr) {
    const v = xhr.dmapVfs;
    const text = files[v.path];
    const values = {
      readyState: 4,
      status: text != null ? 200 : 404,
      statusText: text != null ? 'OK' : 'Not Found',
      responseText: text != null ? text : '',
      response: text != null ? text : '',
      responseXML: null,
      responseURL: v.href,
    };
    for (const key in values) {
      Object.defineProperty(xhr, key, { configurable: true, value: values[key] });
    }
    xhr.dispatchEvent(new Event('readystatechange'));
    xhr.dispatchEvent(new ProgressEvent(text != null ? 'load' : 'error'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  }

  const proto = XMLHttpRequest.prototype;
  const native = {
    open: proto.open,
    send: proto.send,
    setRequestHeader: proto.setRequestHeader,
    overrideMimeType: proto.overrideMimeType,
    getResponseHeader: proto.getResponseHeader,
    getAllResponseHeaders: proto.getAllResponseHeaders,
    abort: proto.abort,
  };

  proto.open = function (method, url, async) {
    const path = vfsPath(method, url);
    if (path == null) {
      this.dmapVfs = null;
      return native.open.apply(this, arguments);
    }
    this.dmapVfs = { path: path, href: new URL(url, base).href, async: async !== false };
  };

  proto.send = function () {
    const xhr = this;
    if (xhr.dmapVfs == null) {
      return native.send.apply(xhr, arguments);
    }
    if (!xhr.dmapVfs.async) {
      // A synchronous request gets only a file that a script file already gave.
      answer(xhr);
      return;
    }
    load(xhr.dmapVfs.path, function () {
      setTimeout(function () {
        answer(xhr);
      }, 0);
    });
  };

  // The other methods do nothing for a listed file: there is no native request.
  function nativeOnly(name, virtual) {
    proto[name] = function () {
      return this.dmapVfs == null ? native[name].apply(this, arguments) : virtual.apply(this, arguments);
    };
  }
  nativeOnly('setRequestHeader', function () {});
  nativeOnly('overrideMimeType', function () {});
  nativeOnly('abort', function () {});
  nativeOnly('getResponseHeader', function (name) {
    return String(name).toLowerCase() === 'content-type' ? 'text/plain;charset=utf-8' : null;
  });
  nativeOnly('getAllResponseHeaders', function () {
    return 'content-type: text/plain;charset=utf-8\r\n';
  });

  // Sends a payload to the host through the channel. Null when there is no channel.
  let toHost = null;
  const fetches = {};
  let nextFetch = 1;

  function openChannel() {
    const meta = document.querySelector('meta[name="dmap-channel"]');
    const token = meta != null ? meta.getAttribute('content') : '';
    const host = window.parent;
    if (!token || host === window) {
      return;
    }
    const channel = new MessageChannel();
    const port = channel.port1;
    const postToHost = port.postMessage;
    toHost = function (data) {
      postToHost.call(port, data);
    };
    // draw.io passes '*' as the second argument. For a MessagePort that is the transfer list: ignore it.
    port.postMessage = toHost;
    port.onmessage = function (e) {
      if (typeof e.data === 'string' && e.data.indexOf('{"dmapFile":') === 0) {
        fileReply(e.data);
        return;
      }
      window.dispatchEvent(new MessageEvent('message', { data: e.data, source: port }));
    };
    window.parent = port;
    host.postMessage(JSON.stringify({ dmapHello: token }), '*', [channel.port2]);
  }

  function fileReply(data) {
    let reply;
    try {
      reply = JSON.parse(data);
    } catch (e) {
      return;
    }
    const done = fetches[reply.dmapFile];
    if (done != null) {
      delete fetches[reply.dmapFile];
      done(reply.dataUri || null);
    }
  }

  /** Asks the host for the data: URL of an image file in <base>. done(null) when the host has no answer. */
  function hostFetch(href, done) {
    const id = nextFetch++;
    const timer = setTimeout(function () {
      delete fetches[id];
      done(null);
    }, 10000);
    fetches[id] = function (dataUri) {
      clearTimeout(timer);
      done(dataUri);
    };
    toHost(JSON.stringify({ dmapFetch: id, url: href }));
  }

  /** Called by js/PostConfig.js after app.min.js. */
  window.dmapAfterApp = function () {
    const convert = Editor.prototype.convertImageToDataUri;
    Editor.prototype.convertImageToDataUri = function (url, done) {
      const self = this;
      const args = arguments;
      let href = null;
      try {
        href = new URL(url, base).href;
      } catch (e) {
        href = null;
      }
      if (toHost == null || href == null || href.indexOf(base) !== 0) {
        return convert.apply(self, args);
      }
      hostFetch(href, function (dataUri) {
        if (dataUri) {
          done(dataUri);
        } else {
          convert.apply(self, args);
        }
      });
    };
  };

  /**
   * Lost right-button release. Safari on macOS sends a quick two-finger tap as a right press with no button down in
   * `buttons`, and then sends no release. draw.io starts a right-button pan on the press and opens the menu on the
   * release. Without the release, every later move pans the canvas, and the menu opens only on the next right click.
   *
   * For each event family (draw.io uses mouse events on a Mac and pointer events elsewhere), the shim watches the right
   * presses on the diagram canvas and sends the missing release at the place and target of the press:
   * - after the context menu event of a press with no button down,
   * - before the first move of the same pointer with no button down,
   * - before the next right press of the same pointer, or the next press with no button down.
   * A release from the browser ends the watch, so a normal right click gets no second release. A press or move with
   * another button down (Ctrl + click in Firefox on a Mac, a chorded press) never ends a right drag.
   *
   * Trade-off: a right press that loses its release for another reason (a focus change while the button is down)
   * also ends at the next move with no button down. If the pointer did not move, draw.io then opens its menu at the
   * press. Without the shim, every move would pan the canvas.
   */
  function watchRightRelease(down, move, up, Ctor) {
    let open = null;

    function release() {
      const press = open;
      open = null;
      if (press == null) {
        return;
      }
      const e = press.event;
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: e.view,
        detail: e.detail,
        button: 2,
        buttons: 0,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
      };
      const target = press.target.isConnected ? press.target : document;
      target.dispatchEvent(new Ctor(up, init));
    }

    /**
     * Only a press on the diagram canvas starts a pan. Other targets get no added release: on a row of the draw.io
     * menu, a release runs the menu item, also after the user dragged out of the frame to cancel it.
     */
    function onCanvas(target) {
      return target instanceof Element && target.closest('.geDiagramContainer') != null;
    }

    /** Mouse events have no pointerId: they always match. */
    function samePointer(e) {
      return open != null && open.event.pointerId === e.pointerId;
    }

    document.addEventListener(
      down,
      function (e) {
        if (samePointer(e) && (e.button === 2 || e.buttons === 0)) {
          release();
        }
        if (e.button === 2 && onCanvas(e.target)) {
          open = { event: e, target: e.target, lost: e.buttons === 0 };
        }
      },
      true
    );
    document.addEventListener(
      move,
      function (e) {
        if (samePointer(e) && e.buttons === 0) {
          release();
        }
      },
      true
    );
    document.addEventListener(
      up,
      function (e) {
        if (samePointer(e) && e.button === 2) {
          open = null;
        }
      },
      true
    );
    if (up === 'pointerup') {
      document.addEventListener(
        'pointercancel',
        function (e) {
          if (samePointer(e)) {
            open = null;
          }
        },
        true
      );
    }
    // The timer runs after all context menu handlers, so the order is the order of a Mac: press, menu event, release.
    // It releases only the press that was open at the menu event.
    document.addEventListener(
      'contextmenu',
      function () {
        const press = open;
        if (press != null && press.lost) {
          setTimeout(function () {
            if (open === press) {
              release();
            }
          }, 0);
        }
      },
      true
    );
  }

  if (typeof PointerEvent === 'function') {
    watchRightRelease('pointerdown', 'pointermove', 'pointerup', PointerEvent);
  }
  watchRightRelease('mousedown', 'mousemove', 'mouseup', MouseEvent);

  openChannel();
})();
