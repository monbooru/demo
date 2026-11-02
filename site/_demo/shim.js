/* monbooru demo shim. Loaded before htmx on every page of this
 * read-only snapshot. It answers the app's own requests from the static
 * files, runs searches, sorting and suggestions in the browser from
 * _demo/index.js, draws the tag lists no file holds from
 * _demo/tag-rows.json, and turns every write into a notice. */
(function () {
  'use strict';
  var IDX = window.__demoIndex || {};
  var ROOT = document.documentElement.getAttribute('data-demo-root') || '';
  var NOTICE = 'This is a read-only demo. Install monbooru to try it.';
  var PREFS = { ceiling: 'monbooru_demo_ceiling', pageSize: 'monbooru_demo_page_size', thumb: 'monbooru_demo_thumb' };
  var STATIC_EXT = /\.(css|js|png|jpe?g|webp|gif|svg|ico|woff2?|json|mp4|webm|avif|jxl|txt|map)$/i;

  var files = new Set(IDX.files || []);
  Object.keys(IDX.frags || {}).forEach(function (k) { files.add(IDX.frags[k]); });
  var imgById = {};
  (IDX.images || []).forEach(function (i) { imgById[i.id] = i; });
  var catByName = {};
  var catById = IDX.categories || {};
  Object.keys(catById).forEach(function (id) { catByName[catById[id].name] = Number(id); });
  var tags = IDX.tags || {};
  var tagIds = Object.keys(tags).map(Number);

  // ---------------------------------------------------------------- prefs
  function pref(k) { try { return localStorage.getItem(PREFS[k]); } catch (e) { return null; } }
  function setPref(k, v) { try { if (v == null) localStorage.removeItem(PREFS[k]); else localStorage.setItem(PREFS[k], v); } catch (e) {} }
  function pageSize() {
    var v = pref('pageSize');
    var n = parseInt(v, 10);
    return n > 0 ? n : (IDX.pageSize || 40);
  }
  function ceilingRank() {
    var v = pref('ceiling');
    var i = (IDX.ratings || []).indexOf(v);
    return i < 0 ? (IDX.ratings || []).length - 1 : i;
  }
  function prefsDefault() { return !pref('ceiling') && pageSize() === (IDX.pageSize || 40); }

  // ------------------------------------------------------- url -> file
  // Mirrors map_url in crawl.py.
  var DEFAULTS = { tags: { q: '', sort: 'usage', order: 'desc', type: 'tag', show_zero: '1', page: '1',
                           origin: '', used_by: '', created_after: '', conflicts: '', stale: '', folded: '' } };
  function slug(p, query) {
    var d = DEFAULTS[p] || {};
    var pairs = [];
    new URLSearchParams(query).forEach(function (v, k) { if (v !== '' && d[k] !== v) pairs.push([k, v]); });
    // An empty type= is the All filter, which keeps a file of its own.
    if (p === 'tags' && new URLSearchParams(query).get('type') === '') pairs.push(['type', 'all']);
    pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    return pairs.map(function (q) { return q[0] + '=' + q[1]; }).join('&').replace(/[^A-Za-z0-9_=&.,:-]/g, '_');
  }
  function urlToFile(path, query) {
    var p = path.replace(/^\/+/, '');
    if (p === '') return 'index.html' + (query ? '?' + query : '');
    var m = /^images\/(\d+)\/(view|file|page\/(\d+)(\/thumb)?)$/.exec(p);
    if (m) {
      var img = imgById[Number(m[1])];
      if (!img) return p + '.bin';
      if (m[3]) {
        var pg = (img.pages || []).filter(function (e) { return e[0] === Number(m[3]); })[0];
        return pg ? (m[4] ? pg[1].replace(/\.[a-z0-9]+$/, '/thumb.jpg') : pg[1]) : p + '.bin';
      }
      return img[m[2]] || p + '.bin';
    }
    if (STATIC_EXT.test(p)) return p;
    if (/^images\/\d+$/.test(p) || /^tags\/\d+$/.test(p)) return p + '.html' + (query ? '?' + query : '');
    if (query && (/^tags$/.test(p) || /^collections$/.test(p) || /^collections\/order$/.test(p) || /^relations\/browse$/.test(p) || /^images\/\d+\/(tags|read)$/.test(p))) {
      var sl = slug(p, query);
      return p + (sl ? '._q_' + sl : '') + '.html';
    }
    return p + '.html';
  }
  // An app URL ('/images/12?back_q=a#x') to a URL that works from this page.
  function url(app) {
    if (typeof app !== 'string' || app.charAt(0) !== '/' || app.charAt(1) === '/') return app;
    var hash = '';
    var i = app.indexOf('#');
    if (i >= 0) { hash = app.slice(i); app = app.slice(0, i); }
    var q = '';
    i = app.indexOf('?');
    if (i >= 0) { q = app.slice(i + 1); app = app.slice(0, i); }
    return ROOT + urlToFile(app, q) + hash;
  }
  function fileOf(app) {
    var u = url(app).slice(ROOT.length);
    return u.split('?')[0].split('#')[0];
  }
  function inDemo(app) {
    var f = fileOf(app);
    return !/\.html$/.test(f) || files.has(f);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function unesc(s) { var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
  function rewriteHTML(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\b(href|src|action|data-esc-back|poster)="(\/[^"\/][^"]*|\/)"/g, function (m, attr, raw) {
      var v = unesc(raw);
      return attr + '="' + esc(url(v)) + '"';
    });
  }
  function notInDemoText(app) {
    var p = app.split('?')[0];
    if (/^\/settings/.test(p)) return 'Settings are not part of the demo.';
    if (/^\/(login|setup)/.test(p)) return 'There is no login in the demo.';
    if (/^\/api\//.test(p)) return 'The API reference is not part of the demo.';
    // The editors an image or tag page opens are the start of a write.
    if (/^\/(images|tags)\/\d+\//.test(p)) return NOTICE;
    if (/^\/tags\b/.test(p)) return 'That tag-list filter is not part of the demo.';
    return 'That page is not part of the demo.';
  }

  // --------------------------------------------------------------- notice
  var noticeTimer = null;
  var pendingPush = null;
  var shownPath = location.pathname + location.search;
  // A refused write ends its dialog: the notice sits behind a modal's
  // backdrop, so the button would seem to do nothing.
  function closeModals() {
    document.querySelectorAll('dialog[open]').forEach(function (d) {
      if (d.id !== 'slideshow-dialog' && d.id !== 'image-lightbox') d.close();
    });
  }
  function notice(text) {
    var el = document.getElementById('page-notice');
    if (!el) return;
    if (text === NOTICE) closeModals();
    el.textContent = text;
    delete el.dataset.session;
    el.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { el.hidden = true; }, 6000);
  }

  // --------------------------------------------------------------- engine
  // tokenize, unquote, normalizeTag and parseQuery mirror
  // internal/search/parser.go.
  function skipQuoted(q, j) {
    for (var k = j + 1; k < q.length; k++) {
      if (q.charAt(k) === '\\' && k + 1 < q.length) { k++; continue; }
      if (q.charAt(k) === '"') return { end: k + 1, closed: true };
    }
    return { end: q.length, closed: false };
  }
  // The tokens, each { not: true }, { or: true } or { term: 'text' }, and
  // whether a quote was left open. AND is dropped: terms already combine.
  function tokenize(q) {
    q = q.trim();
    var toks = [], open = false, i = 0;
    while (i < q.length) {
      var c = q.charAt(i);
      if (c === ' ' || c === '\t') { i++; continue; }
      if (q.substr(i, 4).toLowerCase() === 'not ') { toks.push({ not: true }); i += 4; continue; }
      var next = q.charAt(i + 1);
      if (c === '-' && next !== '' && next !== ' ') { toks.push({ not: true }); i++; continue; }
      var j = i, r;
      if (c === '"') {
        r = skipQuoted(q, j);
        j = r.end;
        if (!r.closed) open = true;
      } else {
        while (j < q.length && q.charAt(j) !== ' ' && q.charAt(j) !== '\t') {
          var ch = q.charAt(j);
          var opens = ch === ':' || (ch === '=' && q.slice(i, j).indexOf(':') > 0);
          if (opens && q.charAt(j + 1) === '"') {
            r = skipQuoted(q, j + 1);
            j = r.end;
            if (!r.closed) open = true;
            break;
          }
          j++;
        }
      }
      var term = q.slice(i, j);
      i = j;
      var low = term.toLowerCase();
      if (low === 'or') toks.push({ or: true });
      else if (low !== 'and') toks.push({ term: term });
    }
    return { toks: toks, open: open };
  }
  function unescapeQuoted(s) { return s.replace(/\\(["\\])/g, '$1'); }
  function unquote(s) {
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') return unescapeQuoted(s.slice(1, -1));
    return s;
  }
  // Lower case, and any run of spaces inside a name folds to one underscore.
  function normalizeTag(s) { return s.toLowerCase().trim().replace(/\s+/g, '_'); }
  function wildcard(pat) {
    if (pat.indexOf('*') < 0) return null;
    return new RegExp('^' + pat.split('*').map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$');
  }
  // Tag ids whose name matches, aliases resolved to their canonical tag.
  function tagSet(pat, catId) {
    var set = {};
    var re = wildcard(pat);
    tagIds.forEach(function (id) {
      var t = tags[id];
      if (catId != null && t.c !== catId) return;
      if (re ? !re.test(t.n) : t.n !== pat) return;
      set[t.a || id] = true;
    });
    return set;
  }
  function tagPred(pat, catId) {
    var set = tagSet(pat, catId);
    return function (img) {
      for (var i = 0; i < img.tags.length; i++) if (set[img.tags[i]]) return true;
      return false;
    };
  }
  // A bare term: * only counts at either end, and a term of nothing but *
  // matches nothing rather than every tag.
  function bareTagPred(name) {
    var inner = name.replace(/^\*/, '').replace(/\*$/, '');
    if (inner === '' || inner.indexOf('*') >= 0) return function () { return false; };
    return tagPred(name, null);
  }
  function hexWords(hex) { return [parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8), 16)]; }
  function popcount(n) {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
  function hamming(a, b) {
    var x = hexWords(a), y = hexWords(b);
    return popcount(x[0] ^ y[0]) + popcount(x[1] ^ y[1]);
  }
  function parseNum(v, kind) {
    if (kind === 'size') {
      var m = /^(\d+(?:\.\d+)?)\s*([kmgt]i?b|b)?$/i.exec(v);
      if (!m) return NaN;
      var n = parseFloat(m[1]);
      var u = (m[2] || 'b').toLowerCase().replace('i', '');
      return n * Math.pow(1024, 'bkmgt'.indexOf(u.charAt(0)));
    }
    return parseFloat(v);
  }
  // 'YYYY[-MM[-DD[THH[:MM[:SS]]]]]' -> [start, end) in ms, UTC.
  function dateWindow(v) {
    var m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?)?)?$/.exec(v);
    if (!m) return null;
    var parts = [m[1], m[2], m[3], m[4], m[5], m[6]];
    var depth = parts.filter(function (x) { return x != null; }).length;
    var a = [Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1, Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
    var start = Date.UTC(a[0], a[1], a[2], a[3], a[4], a[5]);
    var b = a.slice();
    if (depth === 1) b[0]++; else if (depth === 2) b[1]++; else if (depth === 3) b[2]++; else if (depth === 4) b[3]++; else if (depth === 5) b[4]++; else b[5]++;
    return [start, Date.UTC(b[0], b[1], b[2], b[3], b[4], b[5])];
  }
  // '>=5', '3..7', '..7', '3..', '5' against a number getter.
  function cmpPred(val, get, kind) {
    var m = /^(>=|<=|>|<|=)?(.*)$/.exec(val);
    var op = m[1] || '=', rest = m[2];
    var r = rest.indexOf('..');
    if (kind === 'date') {
      var lo = null, hi = null;
      if (r >= 0) {
        var w1 = rest.slice(0, r) ? dateWindow(rest.slice(0, r)) : null;
        var w2 = rest.slice(r + 2) ? dateWindow(rest.slice(r + 2)) : null;
        if ((rest.slice(0, r) && !w1) || (rest.slice(r + 2) && !w2)) return null;
        lo = w1 ? w1[0] : null; hi = w2 ? w2[1] : null;
        return function (img) { var x = get(img); return x != null && (lo == null || x >= lo) && (hi == null || x < hi); };
      }
      var w = dateWindow(rest);
      if (!w) return null;
      if (op === '=') return function (img) { var x = get(img); return x != null && x >= w[0] && x < w[1]; };
      if (op === '>') return function (img) { var x = get(img); return x != null && x >= w[1]; };
      if (op === '>=') return function (img) { var x = get(img); return x != null && x >= w[0]; };
      if (op === '<') return function (img) { var x = get(img); return x != null && x < w[0]; };
      return function (img) { var x = get(img); return x != null && x < w[1]; };
    }
    if (r >= 0) {
      var a = rest.slice(0, r) ? parseNum(rest.slice(0, r), kind) : null;
      var b = rest.slice(r + 2) ? parseNum(rest.slice(r + 2), kind) : null;
      if ((a != null && isNaN(a)) || (b != null && isNaN(b))) return null;
      return function (img) { var x = get(img); return x != null && (a == null || x >= a) && (b == null || x <= b); };
    }
    var n = parseNum(rest, kind);
    if (isNaN(n)) return null;
    return function (img) {
      var x = get(img);
      if (x == null) return false;
      switch (op) {
        case '>': return x > n; case '<': return x < n; case '>=': return x >= n; case '<=': return x <= n;
        default: return x === n;
      }
    };
  }
  function bool(v) { return v === '' || v === 'true' || v === '1'; }
  function listHas(list, v) { return list.map(function (s) { return s.toLowerCase(); }).indexOf(v.toLowerCase()) >= 0; }
  var TYPE_BUCKETS = { image: ['jpeg', 'png', 'webp', 'avif', 'jxl'], archive: ['cbz'], animated: ['gif', 'mp4', 'webm'] };

  // key -> function(value) returning a predicate, null when the value is
  // malformed, or the string 'unsupported'.
  var FILTERS = {
    fav: function (v) { var b = bool(v); return function (img) { return !!img.fav === b; }; },
    inbox: function (v) { var b = bool(v); return function (img) { return !!img.inbox === b; }; },
    missing: function (v) { var b = bool(v); return function (img) { return !!img.missing === b; }; },
    ai: function (v) {
      var want = v.split(',').map(function (s) { return s === 'sd' ? 'a1111' : s; });
      return function (img) {
        var ai = img.ai || 'none';
        if (want.indexOf('any') >= 0) return ai !== 'none';
        if (want.indexOf('none') >= 0 && ai === 'none') return true;
        return want.indexOf(ai) >= 0;
      };
    },
    source: function (v) {
      if (v === '' || v === 'none') return function (img) { return img.src.length === 0; };
      if (v === 'any') return function (img) { return img.src.length > 0; };
      return function (img) { return listHas(img.src, v); };
    },
    cat: function (v) { var c = catByName[v]; if (c == null) return function () { return false; }; return function (img) { return img.tags.some(function (id) { return tags[id] && tags[id].c === c; }); }; },
    width: function (v) { return cmpPred(v, function (i) { return i.w; }); },
    height: function (v) { return cmpPred(v, function (i) { return i.h; }); },
    size: function (v) { return cmpPred(v, function (i) { return i.size; }, 'size'); },
    ratio: function (v) { return cmpPred(v, function (i) { return i.h ? i.w / i.h : null; }); },
    pages: function (v) { return cmpPred(v, function (i) { return i.pages || 0; }); },
    duration: function (v) { return cmpPred(v, function (i) { return i.dur; }); },
    tagcount: function (v) {
      var m = /^([a-z_]+)(=|>=|<=|>|<)?(.*)$/.exec(v);
      if (m && catByName[m[1]] != null) {
        var c = catByName[m[1]];
        var rest = (m[2] === '=' ? '' : (m[2] || '')) + m[3];
        return cmpPred(rest, function (i) { return i.tags.filter(function (id) { return tags[id] && tags[id].c === c; }).length; });
      }
      return cmpPred(v, function (i) { return i.tc; });
    },
    date: function (v) { return cmpPred(v, function (i) { return i.at ? Date.parse(i.at) : null; }, 'date'); },
    type: function (v) {
      var types = [];
      v.split(',').forEach(function (b) { types = types.concat(TYPE_BUCKETS[b] || []); });
      return function (img) { return types.indexOf(img.type) >= 0; };
    },
    mime: function (v) {
      var types = v.split(',').map(function (s) { return s.replace(/^(image|video)\//, '').replace('jpg', 'jpeg'); });
      return function (img) { return types.indexOf(img.type) >= 0; };
    },
    collection: function (v) {
      if (v === '') return function (img) { return img.col.length === 0; };
      if (v === 'any') return function (img) { return img.col.length > 0; };
      return function (img) { return img.col.some(function (c) { return c[0].toLowerCase() === v.toLowerCase(); }); };
    },
    tagged: function (v) {
      if (v === '' || v === 'true') return function (img) { return img.tsrc.some(function (s) { return s !== 'monbooru'; }); };
      if (v === 'false') return function (img) { return !img.tsrc.some(function (s) { return s !== 'monbooru'; }); };
      return function (img) { return listHas(img.tsrc, v); };
    },
    autotagged: function (v) {
      if (v === '' || v === 'true') return function (img) { return img.tauto.length > 0; };
      if (v === 'false') return function (img) { return img.tauto.length === 0; };
      return function (img) { return listHas(img.tauto, v); };
    },
    stale: function (v) {
      if (v === 'none') return function (img) { return !img.stale; };
      return function (img) { return img.stale > 0; };
    },
    folder: function (v) {
      var f = v.replace(/\/+$/, '');
      if (f === '') return function (img) { return !img.missing; };
      return function (img) { return img.folder === f || img.folder.indexOf(f + '/') === 0; };
    },
    folderonly: function (v) { var f = v.replace(/\/+$/, ''); return function (img) { return img.folder === f; }; },
    rating: function (v) { return function (img) { return img.rating === v; }; },
    name: function (v) { var s = v.toLowerCase(); return function (img) { return img.name.indexOf(s) >= 0; }; },
    hash: function (v) { var s = v.toLowerCase(); return function (img) { return img.sha === s || img.md5 === s; }; },
    md5: function (v) { var s = v.toLowerCase(); if (!s) return function (img) { return !!img.md5; }; return function (img) { return img.md5 === s; }; },
    id: function (v) { var n = parseInt(v, 10); return function (img) { return img.id === n; }; },
    batch: function (v) { var n = parseInt(v, 10); return function (img) { return img.batch === n; }; },
    via: function (v) { return function (img) { return img.origin === v; }; },
    prompt: function (v) { var s = v.toLowerCase(); return function (img) { return (img.meta.prompt || '').toLowerCase().indexOf(s) >= 0; }; },
    model: function (v) { var s = v.toLowerCase(); return function (img) { return (img.meta.model || '').toLowerCase().indexOf(s) >= 0; }; },
    sampler: function (v) { var s = v.toLowerCase(); return function (img) { return (img.meta.sampler || '').toLowerCase().indexOf(s) >= 0; }; },
    seed: function (v) { return function (img) { return String(img.meta.seed || '') === v; }; },
    relation: function (v) {
      if (v === 'any') return function (img) { return img.rel.length > 0 || img.col.length > 0; };
      if (v === 'none') return function (img) { return img.rel.length === 0 && img.col.length === 0; };
      if (v === 'collection') return function (img) { return img.col.length > 0; };
      return function (img) { return img.rel.indexOf(v) >= 0; };
    },
    similar: function (v) {
      var m = /^(\d+)(?:~(\d+))?$/.exec(v);
      if (!m) return null;
      var seed = imgById[Number(m[1])];
      if (!seed) return function () { return false; };
      var min = m[2] ? parseInt(m[2], 10) : 1;
      var counted = countedTags(seed);
      return function (img) { return img.id !== seed.id && overlap(img, counted) >= min; };
    },
    comfyui: function () { return 'unsupported'; },
    generated: function () { return 'unsupported'; },
    phash: function (v) {
      var val = v.trim();
      if (val === '') return function (img) { return !!img.phash; };
      var m = /^([0-9a-fA-F]{16})\s*(?:~\s*(\d+))?$/.exec(val);
      if (!m || (m[2] != null && Number(m[2]) > 64)) return function () { return false; };
      var hex = m[1].toLowerCase();
      if (m[2] == null) return function (img) { return img.phash === hex; };
      var dist = Number(m[2]);
      return function (img) { return !!img.phash && hamming(img.phash, hex) <= dist; };
    },
    lookup: function () { return 'unsupported'; },
    upgrade: function () { return 'unsupported'; }
  };
  var metaCat = catByName.meta;
  function countedTags(img) {
    var n = (IDX.images || []).length;
    var set = {};
    img.tags.forEach(function (id) {
      var t = tags[id];
      if (t && t.c !== metaCat && t.u < n) set[id] = true;
    });
    return set;
  }
  function overlap(img, set) {
    var k = 0;
    img.tags.forEach(function (id) { if (set[id]) k++; });
    return k;
  }

  function parseQuery(q) {
    var groups = [], warnings = [], similarSeed = null;
    var parsedToks = tokenize(q);
    if (parsedToks.open) warnings.push('Could not read: unterminated quote.');
    var pendingNot = false, joinOr = false;
    parsedToks.toks.forEach(function (tk) {
      if (tk.or) { joinOr = groups.length > 0; return; }
      if (tk.not) { pendingNot = !pendingNot; return; }
      var neg = pendingNot; pendingNot = false;
      var tok = tk.term, t = tok;
      var pred = null, unsupported = false;
      var m = /^([A-Za-z_]+):(.*)$/.exec(t);
      if (m) {
        var key = m[1].toLowerCase(), val = unquote(m[2]);
        if (catByName[key] != null) {
          pred = tagPred(normalizeTag(val), catByName[key]);
        } else if (FILTERS[key]) {
          var r = FILTERS[key](val);
          if (r === 'unsupported') unsupported = true;
          else if (r == null) { warnings.push('"' + tok + '" is not a value the ' + key + ': filter understands.'); pred = function () { return false; }; }
          else pred = r;
          if (key === 'similar' && !neg && pred) similarSeed = imgById[parseInt(val, 10)] || null;
        } else {
          warnings.push('"' + key + ':" is not a search filter.');
          pred = function () { return false; };
        }
      } else {
        pred = bareTagPred(normalizeTag(unquote(t)));
      }
      if (unsupported) {
        warnings.push('The demo cannot run "' + m[1] + ':" searches; that filter needs the server. It was ignored.');
        return;
      }
      var alt = { neg: neg, pred: pred };
      if (joinOr) { groups[groups.length - 1].push(alt); joinOr = false; }
      else groups.push([alt]);
    });
    return { groups: groups, warnings: warnings, similarSeed: similarSeed };
  }
  function matches(img, groups) {
    for (var g = 0; g < groups.length; g++) {
      var ok = false;
      for (var a = 0; a < groups[g].length; a++) {
        var alt = groups[g][a];
        var r = alt.pred(img);
        if (alt.neg ? !r : r) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }
  function hash32(id, seed) {
    var h = (id * 0x9E3779B1 ^ (seed | 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function sorter(sort, order, seed, similarSeed) {
    var dir = order === 'asc' ? 1 : -1;
    var byId = function (a, b) { return dir * (a.id - b.id); };
    if (sort === 'random') {
      var s = parseInt(seed, 10) || 1;
      return function (a, b) { return hash32(a.id, s) - hash32(b.id, s) || a.id - b.id; };
    }
    if (sort === 'filesize') return function (a, b) { return dir * (a.size - b.size) || byId(a, b); };
    if (sort === 'order') {
      return function (a, b) {
        if (a.series !== b.series) return dir * (a.series < b.series ? -1 : 1);
        var an = a.so == null, bn = b.so == null;
        if (an !== bn) return an ? 1 : -1;
        if (!an && a.so !== b.so) return dir * (a.so - b.so);
        return byId(a, b);
      };
    }
    if (sort === 'similarity' && similarSeed) {
      var counted = countedTags(similarSeed);
      return function (a, b) { return dir * (overlap(a, counted) - overlap(b, counted)) || byId(a, b); };
    }
    return function (a, b) { return dir * ((a.at < b.at) ? -1 : (a.at > b.at) ? 1 : 0) || byId(a, b); };
  }
  function runSearch(ctx) {
    var parsed = parseQuery(ctx.q || '');
    var sort = ctx.sort || 'newest';
    if (sort === 'similarity' && !parsed.similarSeed) sort = 'newest';
    var order = ctx.order || (sort === 'order' ? 'asc' : 'desc');
    var ceil = ceilingRank();
    var all = [], hidden = 0;
    (IDX.images || []).forEach(function (img) {
      if (!matches(img, parsed.groups)) return;
      var rank = (IDX.ratings || []).indexOf(img.rating);
      if (rank > ceil) { hidden++; return; }
      all.push(img);
    });
    all.sort(sorter(sort, order, ctx.seed, parsed.similarSeed));
    return { all: all, hidden: hidden, warnings: parsed.warnings, sort: sort, order: order };
  }

  // ------------------------------------------------------------- rendering
  function qs(obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) { if (obj[k] != null && obj[k] !== '') p.set(k, obj[k]); });
    return p.toString();
  }
  // The query string of a search, q always first and always present.
  function searchQS(ctx, extra) {
    var parts = ['q=' + encodeURIComponent(ctx.q || ''), 'sort=' + encodeURIComponent(ctx.sort), 'order=' + encodeURIComponent(ctx.order)];
    if (ctx.seed) parts.push('seed=' + encodeURIComponent(ctx.seed));
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] != null && extra[k] !== '') parts.push(k + '=' + encodeURIComponent(extra[k])); });
    return parts.join('&');
  }
  function backQuery(ctx, page, idx) {
    return '?back_q=' + encodeURIComponent(ctx.q || '') + '&back_sort=' + encodeURIComponent(ctx.sort) + '&back_order=' + encodeURIComponent(ctx.order) +
      (ctx.seed ? '&back_seed=' + encodeURIComponent(ctx.seed) : '') + '&back_page=' + page + '&back_idx=' + idx;
  }
  function gridClass() {
    var cur = document.querySelector('#gallery-grid .thumb-grid');
    var cls = cur ? cur.className : 'thumb-grid fit-natural';
    cls = cls.replace(/\bthumb-(sm|lg)\b/g, '').replace(/\s+/g, ' ').trim();
    var t = pref('thumb');
    if (t === 's') cls += ' thumb-sm';
    if (t === 'l') cls += ' thumb-lg';
    return cls;
  }
  function pageLink(ctx, page, label) {
    var u = '/?' + searchQS(ctx, { page: page });
    return '<a href="' + esc(u) + '" hx-get="' + esc(u) + '">' + label + '</a>';
  }
  function pagination(ctx, page, pages, top) {
    if (pages <= 1) return '';
    var h = '<div class="pagination' + (top ? ' pagination-top' : '') + '" hx-target="#gallery-grid" hx-push-url="true">';
    if (page > 2) h += pageLink(ctx, 1, '« First');
    if (page > 1) h += pageLink(ctx, page - 1, '← Prev');
    h += '<button type="button" class="page-jump current" data-current="' + page + '" data-total="' + pages + '" title="Go to page…">Page ' + page + ' / ' + pages + '</button>';
    if (page < pages) h += pageLink(ctx, page + 1, 'Next →');
    if (page < pages - 1) h += pageLink(ctx, pages, 'Last »');
    return h + '</div>';
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MiB';
    return (n / 1073741824).toFixed(1) + ' GiB';
  }
  // Fills #gallery-grid. Cards already on the page are moved rather than
  // rebuilt, so their thumbnails do not reload and the grid does not blink.
  function renderGrid(grid, res, ctx, page, pages, items, start) {
    if (!items.length) {
      grid.innerHTML = rewriteHTML(IDX.emptyGrid || '<div class="thumb-grid"><div class="no-results">No images found.</div></div>');
      return;
    }
    var existing = {};
    grid.querySelectorAll('.thumb-card[data-id]').forEach(function (c) { existing[c.getAttribute('data-id')] = c; });
    var wrap = document.createElement('div');
    wrap.className = gridClass();
    items.forEach(function (img, i) {
      var card = existing[String(img.id)];
      if (!card) {
        var tmp = document.createElement('div');
        tmp.innerHTML = rewriteHTML(img.tile);
        card = tmp.firstElementChild;
      }
      var a = card.querySelector('a.thumb-link');
      if (a) a.setAttribute('href', url('/images/' + img.id + backQuery(ctx, page, start + i)));
      var ov = card.querySelector('.thumb-overlay');
      if (ov) {
        var b = ov.querySelector('.badge-filesize');
        if (res.sort === 'filesize') {
          if (!b) { b = document.createElement('span'); b.className = 'badge badge-filesize'; ov.insertBefore(b, ov.firstChild); }
          b.textContent = fmtSize(img.size);
        } else if (b) b.remove();
      }
      card.classList.remove('focused');
      wrap.appendChild(card);
    });
    grid.innerHTML = rewriteHTML(pagination(ctx, page, pages, true));
    grid.appendChild(wrap);
    grid.insertAdjacentHTML('beforeend', rewriteHTML(pagination(ctx, page, pages, false)));
  }
  // What the last search drew. The saved page's sidebar asks for its own
  // images once htmx starts, which would undo a search run on load.
  var shownIds = null;
  var sidebarDoc = null;
  function sidebarTemplate() {
    if (!sidebarDoc) sidebarDoc = new DOMParser().parseFromString('<div id="x">' + (IDX.sidebar || '') + '</div>', 'text/html');
    return sidebarDoc.getElementById('x');
  }
  function colorVar(hex) { hex = (hex || '#888888').replace('#', ''); return 'var(--cat-' + hex + ',#' + hex + ')'; }
  function sidebarHTML(ids) {
    var tpl = sidebarTemplate();
    var groupT = tpl.querySelector('.tag-group');
    var rowT = tpl.querySelector('li.tag-entry');
    var shell = tpl.cloneNode(true);
    var groupsEl = shell.querySelector('#tag-groups');
    if (!groupT || !rowT || !groupsEl) return IDX.sidebar || '';
    groupsEl.innerHTML = '';
    var onPage = {};
    ids.forEach(function (id) {
      var img = imgById[id];
      if (img) img.tags.forEach(function (t) { onPage[t] = (onPage[t] || 0) + 1; });
    });
    var byCat = {};
    Object.keys(onPage).forEach(function (t) {
      var tag = tags[t];
      if (!tag) return;
      (byCat[tag.c] = byCat[tag.c] || []).push(Number(t));
    });
    Object.keys(byCat).map(Number).sort(function (a, b) { return catById[a].position - catById[b].position; }).forEach(function (c) {
      var cat = catById[c];
      var g = groupT.cloneNode(true);
      g.setAttribute('data-cat', cat.name);
      var dot = g.querySelector('.cat-dot'); if (dot) dot.style.background = colorVar(cat.color);
      var nm = g.querySelector('.cat-name'); if (nm) nm.textContent = cat.name;
      var ul = g.querySelector('.tag-list-sidebar');
      ul.innerHTML = '';
      byCat[c].sort(function (a, b) { return onPage[b] - onPage[a] || (tags[a].n < tags[b].n ? -1 : 1); }).slice(0, 25).forEach(function (t) {
        var tag = tags[t];
        var li = rowT.cloneNode(true);
        li.className = 'tag-entry';
        li.setAttribute('data-name', tag.n);
        var wiki = li.querySelector('.tag-wiki'); if (wiki) wiki.setAttribute('href', '/tags/' + t);
        var link = li.querySelector('.tag-link');
        if (link) {
          link.setAttribute('href', '/?q=' + encodeURIComponent(cat.name + ':' + tag.n));
          link.setAttribute('data-tag', cat.name + ':' + tag.n);
          link.style.color = colorVar(cat.color);
          link.textContent = tag.n;
        }
        var add = li.querySelector('.tag-add-btn'); if (add) add.setAttribute('data-tag', cat.name + ':' + tag.n);
        var cnt = li.querySelector('.tag-count');
        if (cnt) { cnt.textContent = tag.u; cnt.setAttribute('title', tag.u + ' images in the library with this tag'); }
        ul.appendChild(li);
      });
      groupsEl.appendChild(g);
    });
    return shell.innerHTML;
  }
  function settle(el) {
    if (window.htmx) window.htmx.process(el);
    document.body.dispatchEvent(new CustomEvent('htmx:afterSettle', { bubbles: true, detail: { elt: el } }));
  }
  function renderSidebar(ids) {
    var inner = document.getElementById('sidebar-inner');
    if (!inner) return;
    inner.innerHTML = rewriteHTML(sidebarHTML(ids));
    settle(inner);
  }
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function updateStatus(res, items, ctx) {
    setText('result-count', String(res.all.length));
    var hidden = document.getElementById('footer-hidden');
    if (hidden) hidden.innerHTML = res.hidden ? '<span class="footer-sep-strong">::</span><span class="footer-hidden-n">' + res.hidden + ' hidden<span class="footer-wide"> images in the current search</span></span>' : '';
    var warn = document.getElementById('search-warning');
    if (warn) warn.innerHTML = res.warnings.length ? '<div class="flash flash-warn">' + esc(res.warnings.join(' ')) + '</div>' : '';
    var sortEl = document.getElementById('search-sort');
    if (sortEl) {
      var rnd = sortEl.querySelector('option[value="random"]');
      if (res.sort === 'random' && !rnd) { rnd = document.createElement('option'); rnd.value = 'random'; rnd.textContent = 'Random'; sortEl.appendChild(rnd); }
      if (res.sort !== 'random' && rnd) rnd.remove();
      sortEl.value = res.sort;
    }
    syncForm(ctx, res.sort, res.order);
  }
  // The search box, the sort controls and the seed follow the search shown.
  function syncForm(ctx, sort, order) {
    document.querySelectorAll('#page-size-ramp button').forEach(function (b) {
      var v = b.getAttribute('data-page-size');
      var cur = pref('pageSize');
      if (cur && parseInt(cur, 10) === (IDX.pageSize || 40)) cur = null;
      b.setAttribute('aria-pressed', String((cur || 'default') === v));
    });
    var orderEl = document.querySelector('#search-form select[name="order"]');
    if (orderEl) orderEl.value = order;
    var input = document.getElementById('search-input');
    if (input && document.activeElement !== input) input.value = ctx.q;
    var form = document.getElementById('search-form');
    if (!form) return;
    var seedEl = form.querySelector('input[name="seed"]');
    if (sort === 'random' && ctx.seed) {
      if (!seedEl) { seedEl = document.createElement('input'); seedEl.type = 'hidden'; seedEl.name = 'seed'; form.appendChild(seedEl); }
      seedEl.value = ctx.seed;
    } else if (seedEl) seedEl.remove();
  }
  function ctxFrom(get) {
    var sort = get('sort') || 'newest';
    return {
      q: (get('q') || '').trim().replace(/\s+/g, ' '),
      sort: sort,
      order: get('order') || (sort === 'order' ? 'asc' : 'desc'),
      seed: sort === 'random' ? (get('seed') || '') : '',
      page: parseInt(get('page'), 10) || 1,
      at: get('at') || ''
    };
  }
  function search(ctx, push) {
    var grid = document.getElementById('gallery-grid');
    if (!grid) return;
    var key = ctx.q + '|' + ctx.sort + '|' + ctx.order + '|' + ctx.page;
    var frag = IDX.frags && IDX.frags[key];
    if (frag && !prefsDefault()) {
      // The fragment was drawn at the default page size with every rating
      // shown; it still fits when nothing is hidden and both sizes hold
      // the whole result on one page.
      var probe = runSearch(ctx);
      var fits = probe.all.length <= Math.min(pageSize(), IDX.pageSize || 40) && ctx.page === 1;
      if (pref('ceiling') && probe.hidden) fits = false;
      if (!fits) frag = null;
    }
    syncForm(ctx, ctx.sort, ctx.order);
    var inbox = ctx.q === 'inbox:true';
    var navImages = document.querySelector('#nav .nav-images'), navInbox = document.getElementById('inbox-nav');
    if (navImages) navImages.classList.toggle('active', !inbox);
    if (navInbox) navInbox.classList.toggle('active', inbox);
    shownIds = null;
    if (frag && window.htmx) {
      window.htmx.ajax('GET', ROOT + frag + '?v=' + encodeURIComponent(IDX.built || ''), { target: '#gallery-grid', swap: 'innerHTML' });
    } else {
      var res = runSearch(ctx);
      var ps = pageSize();
      var pages = Math.max(1, Math.ceil(res.all.length / ps));
      var page = ctx.page;
      if (ctx.at) {
        var atIdx = res.all.findIndex(function (i) { return String(i.id) === ctx.at; });
        if (atIdx >= 0) page = Math.floor(atIdx / ps) + 1;
      }
      page = Math.min(Math.max(1, page), pages);
      var start = (page - 1) * ps;
      var items = res.all.slice(start, start + ps);
      renderGrid(grid, res, ctx, page, pages, items, start);
      updateStatus(res, items, ctx);
      shownIds = items.map(function (i) { return i.id; });
      renderSidebar(shownIds);
      settle(grid);
    }
    if (push) history.pushState({ demo: true }, '', location.pathname + '?' + searchQS(ctx, { page: ctx.page > 1 ? ctx.page : null }));
    var scroller = document.getElementById('content');
    if (scroller) scroller.scrollTop = 0;
  }
  function searchFromLocation(push) {
    var sp = new URLSearchParams(location.search);
    search(ctxFrom(function (k) { return sp.get(k); }), push);
  }

  // ------------------------------------------------------------ suggestions
  function lastWord(q) {
    var words = q.split(/\s+/);
    for (var i = words.length - 1; i >= 0; i--) if (words[i]) return words[i];
    return '';
  }
  function suggestItems(sampleHTML, items) {
    var doc = new DOMParser().parseFromString('<div id="x">' + sampleHTML + '</div>', 'text/html');
    var list = doc.querySelector('.suggest-list');
    var itemT = doc.querySelector('.suggest-item');
    if (!list || !itemT) return '';
    list.innerHTML = '';
    items.forEach(function (it) {
      var b = itemT.cloneNode(true);
      if (it.color) b.style.color = colorVar(it.color); else b.removeAttribute('style');
      b.setAttribute('data-tag-name', it.name);
      var n = b.querySelector('.suggest-name'); if (n) n.textContent = it.name;
      var c = b.querySelector('.suggest-count');
      if (c) { if (it.count == null) c.remove(); else c.textContent = it.count; }
      list.appendChild(b);
    });
    return list.outerHTML;
  }
  function tagMatches(word, catId, limit) {
    var out = [];
    tagIds.forEach(function (id) {
      var t = tags[id];
      if (t.a) return;
      if (catId != null && t.c !== catId) return;
      if (word && t.n.indexOf(word) < 0) return;
      out.push({ id: id, n: t.n, c: t.c, u: t.u });
    });
    out.sort(function (a, b) { return b.u - a.u || (a.n < b.n ? -1 : 1); });
    return out.slice(0, limit);
  }
  function display(t) { var cat = catById[t.c]; return cat && cat.name !== 'general' ? cat.name + ':' + t.n : t.n; }
  function suggest(q, target, mode) {
    if (!target) return;
    q = q || '';
    var last = lastWord(q);
    var word = last.charAt(0) === '-' ? last.slice(1) : last;
    if (!word) { target.innerHTML = ''; return; }
    var sample = mode === 'tag' ? IDX.tagSuggestSample : IDX.suggestSample;
    var lower = word.toLowerCase();
    var m = /^([a-z_]+):(.*)$/.exec(lower);
    var items = [];
    if (m) {
      var key = m[1] + ':', rest = m[2];
      if (catByName[m[1]] != null) {
        var catId = catByName[m[1]];
        var ctxCount = contextCounter(q, last);
        tagMatches(rest, catId, 10).forEach(function (t) { items.push({ name: m[1] + ':' + t.n, count: ctxCount(t), color: catById[t.c].color }); });
      } else if (mode === 'search' && IDX.suggest && IDX.suggest[key]) {
        if (!rest) { target.innerHTML = IDX.suggest[key]; return; }
        var doc = new DOMParser().parseFromString('<div id="x">' + IDX.suggest[key] + '</div>', 'text/html');
        doc.querySelectorAll('.suggest-item').forEach(function (b) {
          var name = (b.getAttribute('data-tag-name') || '').toLowerCase();
          if (name.indexOf(lower) !== 0) b.remove();
        });
        target.innerHTML = doc.querySelectorAll('.suggest-item').length ? doc.getElementById('x').innerHTML : '';
        return;
      } else { target.innerHTML = ''; return; }
    } else {
      var count = contextCounter(q, last);
      tagMatches(lower, null, 10).forEach(function (t) { items.push({ name: display(t), count: count(t), color: catById[t.c] && catById[t.c].color }); });
    }
    // Inside a query, a tag no remaining image carries is no help.
    if (q.trim().split(/\s+/).length > 1) items = items.filter(function (it) { return it.count !== 0; });
    target.innerHTML = items.length ? suggestItems(sample, items) : '';
  }
  // Counts a tag's images within the rest of the query (the typed word
  // removed), the way the server's dropdown does.
  function contextCounter(q, last) {
    var rest = q.split(/\s+/).filter(Boolean);
    var i = rest.lastIndexOf(last);
    if (i >= 0) rest.splice(i, 1);
    var pool = rest.length ? runSearch({ q: rest.join(' ') }).all : (IDX.images || []);
    return function (t) {
      var n = 0;
      pool.forEach(function (img) { if (img.tags.indexOf(t.id) >= 0) n++; });
      return n;
    };
  }

  // ---------------------------------------------------------- detail page
  function fixDetail() {
    var page = document.getElementById('detail-page');
    if (!page) return;
    var sp = new URLSearchParams(location.search);
    var m = /images\/(\d+)\.html$/.exec(location.pathname);
    if (!m) return;
    var id = Number(m[1]);
    var ctx = {
      q: (sp.get('back_q') || '').trim().replace(/\s+/g, ' '),
      sort: sp.get('back_sort') || 'newest',
      order: sp.get('back_order') || ((sp.get('back_sort') || 'newest') === 'order' ? 'asc' : 'desc'),
      seed: sp.get('back_seed') || ''
    };
    var res = runSearch(ctx);
    var ids = res.all.map(function (i) { return i.id; });
    var idx = ids.indexOf(id);
    if (idx < 0) return;
    var ps = pageSize();
    var pageOf = function (i) { return Math.floor(i / ps) + 1; };
    var back = document.querySelector('.back-link');
    if (back) back.setAttribute('href', url('/?' + searchQS(ctx, { page: pageOf(idx), at: id }) + '#img-' + id));
    var nav = document.querySelector('.detail-meta-nav');
    if (nav) {
      ['prev', 'next'].forEach(function (dir) {
        var word = dir === 'prev' ? 'Prev' : 'Next';
        var old = Array.prototype.find.call(nav.querySelectorAll('.nav-arrow'), function (el) {
          return el.id !== 'slideshow-btn' && el.textContent.indexOf(word) >= 0;
        });
        if (!old) return;
        var ni = dir === 'prev' ? idx - 1 : idx + 1;
        var el;
        if (ni >= 0 && ni < ids.length) {
          el = document.createElement('a');
          el.className = 'nav-arrow';
          el.setAttribute('title', (dir === 'prev' ? 'Previous image (←)' : 'Next image (→)'));
          el.setAttribute('href', url('/images/' + ids[ni] + backQuery(ctx, pageOf(ni), ni)));
        } else {
          el = document.createElement('span');
          el.className = 'nav-arrow nav-arrow-placeholder';
          el.setAttribute('aria-hidden', 'true');
        }
        el.textContent = dir === 'prev' ? '← Prev' : 'Next →';
        old.replaceWith(el);
      });
    }
    var btn = document.getElementById('slideshow-btn');
    if (!btn && nav && document.getElementById('slideshow-dialog')) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'slideshow-btn';
      btn.className = 'nav-arrow';
      btn.setAttribute('onclick', 'slideshow.start(this)');
      btn.setAttribute('title', 'Slideshow from this image (w)');
      btn.setAttribute('data-start', String(id));
      btn.innerHTML = '&#9654;&#xFE0E;';
      nav.appendChild(btn);
    }
    if (btn) {
      btn.setAttribute('data-q', ctx.q);
      btn.setAttribute('data-sort', ctx.sort);
      btn.setAttribute('data-order', ctx.order);
      btn.setAttribute('data-seed', ctx.seed);
      btn.setAttribute('data-next', idx + 1 < ids.length ? String(ids[idx + 1]) : '');
      btn.setAttribute('data-back', '?back_order=' + encodeURIComponent(ctx.order) + '&back_page=' + pageOf(idx) + '&back_q=' + encodeURIComponent(ctx.q) + '&back_sort=' + encodeURIComponent(ctx.sort));
    }
  }

  // -------------------------------------------------------- the tag list
  // Listings the snapshot saved as files stay files. Anything else (a name
  // search, a mix of filters, a later page of a sorted list) is drawn here
  // from _demo/tag-rows.json, loaded the first time it is needed.
  var TAG_KEYS = ['q', 'cat', 'sort', 'order', 'type', 'origin', 'used_by', 'created_after', 'show_zero', 'conflicts', 'stale', 'folded', 'page'];
  var TAG_FILE = /^tags(\._q_.*)?\.html$/;
  var TAGS_PER_PAGE = 100;
  var tagData = null, tagToken = 0;

  function rootPath() { return new URL(ROOT || './', location.href).pathname; }
  function relPath() { return location.pathname.slice(rootPath().length) || 'index.html'; }
  function tagQuery(st, drop) {
    var p = new URLSearchParams();
    TAG_KEYS.forEach(function (k) { if (st[k] && k !== drop) p.set(k, st[k]); });
    return p.toString();
  }
  function tagStateOf(rel, sp) {
    var st = {};
    var set = function (v, k) {
      if (TAG_KEYS.indexOf(k) < 0) return;
      if (k === 'type' && v === '') v = 'all';
      if (DEFAULTS.tags[k] === v) delete st[k]; else st[k] = v;
    };
    var m = /^tags\._q_(.*)\.html$/.exec(rel);
    if (m) new URLSearchParams(m[1]).forEach(set);
    if (sp) sp.forEach(set);
    return st;
  }
  // A link's state, whichever way its href is written: main.js makes them
  // absolute paths while the search box changes.
  function hrefState(a) {
    var u = new URL(a.getAttribute('href') || '', location.href);
    return tagStateOf(u.pathname.slice(rootPath().length), u.searchParams);
  }
  function tagFile(st) {
    var sl = slug('tags', tagQuery(st, 'q'));
    return 'tags' + (sl ? '._q_' + sl : '') + '.html';
  }
  function tagHref(st) {
    if (!st.q && files.has(tagFile(st))) return ROOT + tagFile(st);
    return ROOT + 'tags.html?' + tagQuery(st);
  }
  function loadTagRows() {
    if (!tagData) {
      tagData = realFetch(ROOT + '_demo/tag-rows.json?v=' + encodeURIComponent(IDX.built || ''))
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .catch(function (err) { tagData = null; throw err; });
    }
    return tagData;
  }
  function nameMatcher(q) {
    q = q.trim().toLowerCase();
    if (!q) return function () { return true; };
    if (q.indexOf('*') >= 0) {
      var re = new RegExp('^' + q.split('*').map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$');
      return function (n) { return re.test(n); };
    }
    return function (n) { return n.indexOf(q) === 0; };
  }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  // Mirrors the listing's WHERE and ORDER BY in internal/tags/tags_crud.go.
  function tagRows(data, st) {
    var match = nameMatcher(st.q || '');
    var cat = st.cat ? Number(st.cat) : null;
    var type = st.type || 'tag';
    var zero = st.show_zero || '1';
    var since = null;
    var cm = /^(\d+)([hd])$/.exec(st.created_after || '');
    if (cm) since = Date.parse(data.now) - Number(cm[1]) * (cm[2] === 'h' ? 3600000 : 86400000);
    var rows = data.rows.filter(function (t) {
      if (!match(t.n)) return false;
      if (cat != null && t.c !== cat) return false;
      if (type === 'tag' && t.a) return false;
      if (type === 'alias' && !t.a) return false;
      if (st.origin && t.o !== st.origin) return false;
      if (st.used_by && t.s.indexOf(st.used_by) < 0) return false;
      if (since != null && Date.parse(t.cr) < since) return false;
      if (zero === 'only' && (t.u !== 0 || t.a)) return false;
      if (zero === '0' && t.u <= 0 && !t.a) return false;
      return true;
    });
    var sort = st.sort || 'usage';
    var dir = st.order === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      if (sort === 'created') return dir * cmpStr(a.cr, b.cr) || dir * (a.id - b.id);
      var by = sort === 'name' ? cmpStr(a.n, b.n) : sort === 'last_used' ? cmpStr(a.lu, b.lu) : a.u - b.u;
      return dir * by || cmpStr(a.n, b.n) || a.id - b.id;
    });
    return rows;
  }
  function tagPagination(st, page, pages) {
    if (pages <= 1) return '';
    var link = function (p, label) {
      var next = Object.assign({}, st);
      if (p > 1) next.page = String(p); else delete next.page;
      return '<a href="' + esc(tagHref(next)) + '">' + label + '</a>';
    };
    var h = '<div class="pagination">';
    if (page > 2) h += link(1, '« First');
    if (page > 1) h += link(page - 1, '← Prev');
    h += '<button type="button" class="page-jump current" data-current="' + page + '" data-total="' + pages + '" title="Go to page…">Page ' + page + ' / ' + pages + '</button>';
    if (page < pages) h += link(page + 1, 'Next →');
    if (page < pages - 1) h += link(pages, 'Last »');
    return h + '</div>';
  }
  // Column links point at the state they lead to; a click reads the href
  // back, since htmx keeps the path a boosted link had when it was processed.
  function syncTagHead(root, st) {
    var cur = st.sort || 'usage', order = st.order === 'asc' ? 'asc' : 'desc';
    root.querySelectorAll('a.th-sort').forEach(function (a) {
      if (!a.dataset.sortKey) a.dataset.sortKey = hrefState(a).sort || 'usage';
      var k = a.dataset.sortKey;
      var active = k === cur;
      var next = Object.assign({}, st, { sort: k, order: active ? (order === 'asc' ? 'desc' : 'asc') : (k === 'name' ? 'asc' : 'desc') });
      if (next.sort === 'usage') delete next.sort;
      if (next.order === 'desc') delete next.order;
      delete next.page;
      a.setAttribute('href', tagHref(next));
      var arrow = a.querySelector('.sort-arrow');
      if (arrow) arrow.remove();
      if (active) a.insertAdjacentHTML('beforeend', '<span class="sort-arrow">' + (order === 'asc' ? '▲' : '▼') + '</span>');
    });
  }
  // The filter a sidebar group sets is the one key its buttons disagree on.
  function syncTagSidebar(st) {
    document.querySelectorAll('#sidebar-inner .filter-group').forEach(function (g) {
      var btns = Array.prototype.slice.call(g.querySelectorAll('a.filter-btn'));
      if (!btns.length) return;
      if (!btns[0].dataset.filterKey) {
        var states = btns.map(hrefState);
        var keys = TAG_KEYS.filter(function (k) {
          return k !== 'q' && k !== 'page' && states.some(function (s) { return (s[k] || '') !== (states[0][k] || ''); });
        });
        btns.forEach(function (a, i) {
          a.dataset.filterKey = keys[0] || '';
          a.dataset.filterVal = (keys[0] && states[i][keys[0]]) || '';
        });
      }
      btns.forEach(function (a) {
        var k = a.dataset.filterKey, v = a.dataset.filterVal;
        if (!k) return;
        var next = Object.assign({}, st);
        delete next.page;
        if (v) next[k] = v; else delete next[k];
        a.setAttribute('href', tagHref(next));
        a.classList.toggle('active', (st[k] || '') === v);
      });
    });
  }
  function drawTags(data, st) {
    var page = document.getElementById('tags-page');
    var tbody = page && page.querySelector('table tbody');
    if (!tbody) return;
    var rows = tagRows(data, st);
    var pages = Math.max(1, Math.ceil(rows.length / TAGS_PER_PAGE));
    var cur = Math.min(Math.max(1, parseInt(st.page, 10) || 1), pages);
    var items = rows.slice((cur - 1) * TAGS_PER_PAGE, cur * TAGS_PER_PAGE);
    tbody.innerHTML = items.length
      ? items.map(function (t) { return t.h; }).join('')
      : '<tr><td colspan="9" class="field-hint">No tags match.</td></tr>';
    var badge = page.querySelector('#tags-page-header .count-badge');
    if (badge) badge.textContent = rows.length;
    var bar = document.getElementById('tag-batch-bar');
    if (bar) bar.dataset.total = rows.length;
    var all = document.getElementById('tag-select-all-matching');
    if (all) all.textContent = 'Select all ' + rows.length + ' matching';
    var box = document.getElementById('tag-select-page');
    if (box) box.checked = false;
    var head = page.querySelector('thead');
    var old = page.querySelector('.pagination');
    var wrap = old && old.parentElement;
    if (!wrap) {
      wrap = document.createElement('div');
      ['hx-boost', 'hx-target', 'hx-select', 'hx-swap', 'hx-select-oob', 'hx-push-url'].forEach(function (a) {
        if (head && head.hasAttribute(a)) wrap.setAttribute(a, head.getAttribute(a));
      });
      page.appendChild(wrap);
    }
    wrap.innerHTML = tagPagination(st, cur, pages);
    if (head) syncTagHead(head, st);
    syncTagSidebar(st);
    var input = document.getElementById('tags-q-input');
    if (input && document.activeElement !== input) input.value = st.q || '';
    if (window.htmx) window.htmx.process(page);
    var scroller = document.getElementById('content');
    if (scroller) scroller.scrollTop = 0;
  }
  // how: 'push' adds a history entry, 'replace' rewrites the current one
  // (typing in the box), and anything else leaves the address alone.
  function showTags(st, how) {
    var token = ++tagToken;
    loadTagRows().then(function (data) {
      if (token !== tagToken) return;
      drawTags(data, st);
      if (how === 'push') history.pushState({ demo: true }, '', tagHref(st));
      if (how === 'replace') history.replaceState({ demo: true }, '', tagHref(st));
      shownPath = location.pathname + location.search;
    }).catch(function () { notice('Could not load the tag list.'); });
  }
  // Saved file or browser? Returns after arranging one of them for this request.
  function routeTags(e, st) {
    // Typing a category's name and a colon filters to that category.
    var prefix = /^([a-z_]+):$/.exec((st.q || '').trim().toLowerCase());
    if (prefix && catByName[prefix[1]] != null && !st.cat) { st.cat = String(catByName[prefix[1]]); delete st.q; }
    var file = tagFile(st);
    if (!st.q && files.has(file)) {
      e.detail.path = rootPath() + file;
      clearParams(e.detail.parameters);
      pendingPush = { path: e.detail.path, url: e.detail.path };
      return;
    }
    e.preventDefault();
    if (st.conflicts || st.stale || st.folded) { notice(notInDemoText('/tags')); return; }
    showTags(st, e.detail.elt && e.detail.elt.tagName === 'A' ? 'push' : 'replace');
  }

  // ------------------------------------------------- the collection list
  // Every collection is on the page, so a search only hides the others.
  function filterCollections(q) {
    var page = document.getElementById('collections-page');
    if (!page) return;
    var want = (q || '').trim().toLowerCase();
    var shown = 0;
    page.querySelectorAll('.relations-card[data-name]').forEach(function (c) {
      var hit = c.getAttribute('data-name').toLowerCase().indexOf(want) >= 0;
      c.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    var badge = page.querySelector('#collections-page-header .count-badge');
    if (badge) badge.textContent = shown;
    var none = document.getElementById('demo-no-collections');
    if (!shown && !none) {
      none = document.createElement('p');
      none.id = 'demo-no-collections';
      none.className = 'field-hint';
      none.textContent = 'No collections match.';
      page.appendChild(none);
    }
    if (none) none.hidden = shown > 0;
    var input = document.getElementById('collections-q-input');
    if (input && document.activeElement !== input) input.value = q || '';
  }
  function routeCollections(e, file, q) {
    var cur = /^collections/.test(relPath()) ? relPath() : 'collections.html';
    var sortOf = function (f) { var m = /sort=(\w+)/.exec(f); return m ? m[1] : 'size'; };
    if (sortOf(file) === sortOf(cur)) {
      e.preventDefault();
      filterCollections(q);
      history.replaceState({ demo: true }, '', location.pathname + (q ? '?q=' + encodeURIComponent(q) : ''));
      shownPath = location.pathname + location.search;
      return;
    }
    var abs = rootPath() + file;
    e.detail.path = abs;
    clearParams(e.detail.parameters);
    pendingPush = { path: abs, url: abs + (q ? '?q=' + encodeURIComponent(q) : ''), after: function () { filterCollections(q); } };
  }

  // ------------------------------------------------------------- the footer
  function applyCeilingFooter() {
    var level = pref('ceiling');
    if (!level) return;
    var forms = document.querySelectorAll('form[hx-post^="/internal/rating-ceiling"]');
    var active = document.querySelector('.footer-rating-active');
    if (!forms.length || !active) return;
    var activeForm = document.createElement('form');
    activeForm.setAttribute('hx-post', '/internal/rating-ceiling?level=explicit');
    activeForm.setAttribute('hx-swap', 'none');
    activeForm.style.display = 'inline';
    activeForm.innerHTML = '<button type="submit" class="footer-rating-link" title="Show every rating (this browser only)">explicit</button>';
    active.replaceWith(activeForm);
    forms.forEach(function (f) {
      var lv = (new URL(f.getAttribute('hx-post'), location.origin)).searchParams.get('level');
      if (lv !== level) return;
      var b = f.querySelector('button');
      var span = document.createElement('span');
      span.className = 'footer-rating-active';
      span.setAttribute('title', b ? b.getAttribute('title') : '');
      span.textContent = '[' + (b ? b.textContent : level) + ']';
      f.replaceWith(span);
    });
    var footer = document.getElementById('footer');
    if (footer && window.htmx) window.htmx.process(footer);
  }
  function applyThumbPref() {
    var t = pref('thumb');
    if (!t) return;
    var grid = document.querySelector('.thumb-grid');
    if (grid) { grid.classList.toggle('thumb-sm', t === 's'); grid.classList.toggle('thumb-lg', t === 'l'); }
    document.querySelectorAll('#thumb-size-ramp button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-thumb') === t)); });
  }

  // ------------------------------------------------------------------ hooks
  function paramGet(params, k) {
    if (!params) return null;
    if (typeof params.get === 'function') return params.get(k);
    return params[k] == null ? null : params[k];
  }
  function jsonResponse(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  function scopedImages(body) {
    if (body.get('scope') === 'selection') {
      return (body.get('ids') || '').split(',').map(function (n) { return imgById[Number(n)]; }).filter(Boolean);
    }
    return runSearch(ctxFrom(function (k) { return body.get(k); })).all;
  }
  function categoryCounts(id) {
    var c = { count: 0, aliases: 0, linked_aliases: 0, implications: (catById[id] || {}).implications || 0 };
    tagIds.forEach(function (t) {
      var tag = tags[t];
      if (tag.c === id) { if (tag.a) c.aliases++; else c.count++; }
      else if (tag.a && tags[tag.a] && tags[tag.a].c === id) c.linked_aliases++;
    });
    return c;
  }
  function clearParams(params) {
    if (params && typeof params.forEach === 'function') { Array.from(params.keys()).forEach(function (k) { params.delete(k); }); }
    else if (params) { Object.keys(params).forEach(function (k) { delete params[k]; }); }
  }
  function refuse() {
    return Promise.resolve(new Response(NOTICE, { status: 403, headers: { 'Content-Type': 'text/plain' } }));
  }
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (u.charAt(0) !== '/' || u.charAt(1) === '/') return realFetch(input, init);
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var parsed = new URL(u, location.origin);
      var p = parsed.pathname;
      if (method === 'GET') {
        if (p === '/internal/search/ids') {
          var res = runSearch({ q: parsed.searchParams.get('q') || '' });
          return jsonResponse({ ids: res.all.map(function (i) { return i.id; }) });
        }
        var catCount = /^\/tags\/categories\/(\d+)\/count$/.exec(p);
        if (catCount) return jsonResponse(categoryCounts(Number(catCount[1])));
        if (!inDemo(u)) return Promise.resolve(new Response('', { status: 404 }));
        // Fragments the page inserts itself, like the collection order
        // dialog, get their links rewritten the way htmx swaps do.
        return realFetch(url(u), init).then(function (res) {
          if (!/text\/html/.test(res.headers.get('Content-Type') || '')) return res;
          return res.text().then(function (t) {
            return new Response(rewriteHTML(t), { status: res.status, statusText: res.statusText, headers: res.headers });
          });
        });
      }
      var body = new URLSearchParams(init && typeof init.body === 'string' ? init.body : '');
      if (p === '/internal/slideshow') {
        var ids = scopedImages(body).map(function (i) { return i.id; });
        var start = Math.max(0, ids.indexOf(Number(body.get('start'))));
        return jsonResponse({ ids: ids, videos: [], start: start });
      }
      // Counts, not writes: their dialogs need them before they can open.
      if (p === '/internal/batch-download/count') {
        var scoped = scopedImages(body);
        var present = scoped.filter(function (i) { return !i.missing; });
        return jsonResponse({
          files: present.length,
          missing: scoped.length - present.length,
          size: fmtSize(present.reduce(function (n, i) { return n + i.size; }, 0))
        });
      }
      if (p === '/internal/batch-lookup/count') {
        var looked = scopedImages(body);
        var sourced = looked.filter(function (i) { return i.src.length > 0; }).length;
        return jsonResponse({ total: looked.length, sourced: sourced, unsourced: looked.length - sourced });
      }
      if (p === '/internal/view-prefs') {
        if (body.has('page_size')) setPref('pageSize', body.get('page_size') === 'default' ? null : body.get('page_size'));
        if (body.has('thumb')) setPref('thumb', body.get('thumb') === 'm' ? null : body.get('thumb'));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (p === '/internal/rating-ceiling') {
        var lv = parsed.searchParams.get('level');
        setPref('ceiling', lv === 'explicit' ? null : lv);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (p.indexOf('/internal/job/') === 0) return Promise.resolve(new Response(null, { status: 204 }));
      return refuse();
    };
  }

  document.body.addEventListener('htmx:configRequest', function (e) {
    var path = e.detail.path;
    if (typeof path !== 'string' || /^(https?:)?\/\//.test(path)) return;
    if (path.charAt(0) !== '/') {
      // A form whose hx-post the app fills in later.
      if ((e.detail.verb || 'get').toLowerCase() !== 'get') { e.preventDefault(); notice(NOTICE); return; }
      // Already a file path (a rewritten link under hx-boost).
      var elt = e.detail.elt;
      var raw = elt && elt.tagName === 'A' && elt.getAttribute('href') || path;
      var abs = new URL(raw, location.href);
      var rel = abs.pathname.slice(rootPath().length);
      var typed = paramGet(e.detail.parameters, 'q');
      if (TAG_FILE.test(rel)) {
        var st;
        if (elt && elt.tagName === 'FORM') {
          st = tagStateOf(relPath(), new URLSearchParams(location.search));
          delete st.page;
        } else st = tagStateOf(rel, abs.searchParams);
        var box = document.getElementById('tags-q-input');
        var q = typed != null ? typed : abs.searchParams.get('q');
        q = q != null ? q : (box ? box.value : '');
        if (q) st.q = q; else delete st.q;
        routeTags(e, st);
        return;
      }
      if (/^collections(\._q_.*)?\.html$/.test(rel)) {
        var cbox = document.getElementById('collections-q-input');
        routeCollections(e, elt && elt.tagName === 'FORM' ? relPath() : rel, typed != null ? typed : (cbox ? cbox.value : ''));
        return;
      }
      if (/\.html$/.test(rel) && !files.has(rel)) { e.preventDefault(); notice(notInDemoText('/' + rel.replace(/\.html$/, ''))); return; }
      // main.js resolves a sidebar filter's path against the origin, which
      // would drop the subfolder; an absolute path comes through whole.
      e.detail.path = abs.pathname + abs.search;
      if (elt && elt.closest && elt.closest('[hx-push-url="true"]') && /\.html$/.test(rel)) {
        pendingPush = { path: e.detail.path, url: e.detail.path };
      }
      return;
    }
    var parsed = new URL(path, location.origin);
    var p = parsed.pathname;
    var verb = (e.detail.verb || 'get').toLowerCase();
    var get = function (k) { var v = paramGet(e.detail.parameters, k); return v != null ? v : parsed.searchParams.get(k); };
    if (verb !== 'get') {
      e.preventDefault();
      if (p === '/internal/rating-ceiling') {
        var lv = parsed.searchParams.get('level');
        setPref('ceiling', lv === 'explicit' ? null : lv);
        location.reload();
        return;
      }
      notice(NOTICE);
      return;
    }
    if (p === '/') { e.preventDefault(); search(ctxFrom(get), true); return; }
    if (p === '/internal/sidebar') {
      e.preventDefault();
      renderSidebar(shownIds || (get('ids') || '').split(',').map(Number).filter(Boolean));
      return;
    }
    // The tag and collection search boxes.
    if (p === '/tags') {
      var tst = tagStateOf(relPath(), new URLSearchParams(location.search));
      var tq = get('q') || '';
      delete tst.page;
      if (tq) tst.q = tq; else delete tst.q;
      routeTags(e, tst);
      return;
    }
    if (p === '/collections') {
      routeCollections(e, /^collections/.test(relPath()) ? relPath() : 'collections.html', get('q') || '');
      return;
    }
    if (p === '/internal/search/suggest') { e.preventDefault(); suggest(get('q'), e.detail.target || document.getElementById('search-suggest'), 'search'); return; }
    if (p === '/internal/tags/suggest') { e.preventDefault(); suggest(get('q') || get('tags') || get('tag') || '', e.detail.target, 'tag'); return; }
    if (p === '/internal/job/status' || p === '/internal/monloader-status' || p === '/internal/footer-counts') { e.preventDefault(); return; }
    // Form fields ride along as the query string (the tag and collection
    // search boxes), so they count when picking the file.
    var full = path;
    var params = e.detail.parameters;
    if (params) {
      var extra = new URLSearchParams(parsed.search);
      var entries = typeof params.forEach === 'function' && !(params instanceof Array) ? null : Object.keys(params).map(function (k) { return [k, params[k]]; });
      if (entries) entries.forEach(function (kv) { extra.set(kv[0], kv[1]); });
      else params.forEach(function (v, k) { extra.set(k, v); });
      var qs = extra.toString();
      full = p + (qs ? '?' + qs : '');
    }
    if (!inDemo(full)) {
      e.preventDefault();
      // What a dialog asks while you type (a name preview, a folder
      // suggestion) just stays empty.
      if (/^\/internal\//.test(p)) return;
      // The tag table's [edit] opens an editor in the row; the tag's own
      // page lists the same implications.
      var impl = /^\/tags\/(\d+)\/implications$/.exec(p);
      if (impl) { location.href = url('/tags/' + impl[1]); return; }
      notice(notInDemoText(full));
      return;
    }
    e.detail.path = url(full);
    clearParams(params);
  });
  document.body.addEventListener('htmx:beforeSwap', function (e) {
    if (typeof e.detail.serverResponse === 'string') e.detail.serverResponse = rewriteHTML(e.detail.serverResponse);
  });
  document.body.addEventListener('htmx:afterSettle', function (e) {
    var el = e.detail && e.detail.elt;
    if (el && el.id === 'gallery-grid') applyThumbPref();
    // The snapshot runs with htmx's history off (it would cache whole pages
    // in the browser), so hx-push-url is done here.
    var cfg = e.detail && e.detail.requestConfig;
    // main.js may have added ?q= to the path since it was recorded.
    if (pendingPush && cfg && String(cfg.path).split('?')[0] === pendingPush.path.split('?')[0]) {
      var done = pendingPush;
      pendingPush = null;
      if (e.detail.xhr && e.detail.xhr.status < 400) {
        history.pushState({ demo: true }, '', done.url);
        shownPath = location.pathname + location.search;
        if (done.after) done.after();
      }
    }
  });
  // Plain links to pages the snapshot does not hold.
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('hx-get') || a.closest('[hx-boost]')) return;
    var href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:|#|javascript:|data:)/i.test(href) || !/\.html(\?|#|$)/.test(href)) return;
    var abs = new URL(a.href);
    var rootAbs = new URL(ROOT || './', location.href).pathname;
    if (abs.origin !== location.origin || abs.pathname.indexOf(rootAbs) !== 0) return;
    var file = abs.pathname.slice(rootAbs.length);
    if (files.has(file)) return;
    e.preventDefault();
    notice(notInDemoText('/' + file.replace(/\.html$/, '')));
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    var hx = Array.prototype.some.call(f.attributes, function (a) { return a.name.indexOf('hx-') === 0; });
    if (hx) return;
    // Stopped here so the form's own onsubmit (the zip download's) never runs.
    if ((f.getAttribute('method') || 'get').toLowerCase() === 'post') { e.preventDefault(); e.stopPropagation(); notice(NOTICE); }
  }, true);
  // form.submit() fires no submit event, so it needs its own refusal.
  var realSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if ((this.getAttribute('method') || 'get').toLowerCase() === 'post') { notice(NOTICE); return; }
    realSubmit.call(this);
  };
  window.addEventListener('popstate', function () {
    if (document.getElementById('gallery-grid')) { searchFromLocation(false); return; }
    if (location.pathname + location.search !== shownPath) location.reload();
  });

  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.showPageNotice;
    if (typeof orig === 'function') {
      window.showPageNotice = function (text) {
        if (text === NOTICE) closeModals();
        var el = orig(text);
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(function () { if (el) el.hidden = true; }, 6000);
        return el;
      };
    }
    applyCeilingFooter();
    applyThumbPref();
    fixDetail();
    if (document.getElementById('gallery-grid')) {
      var sp = new URLSearchParams(location.search);
      var hasParams = ['q', 'sort', 'order', 'page', 'seed', 'at'].some(function (k) { return sp.has(k); });
      if (hasParams || !prefsDefault()) searchFromLocation(false);
    }
    if (document.getElementById('tags-page') && location.search) {
      var tsp = new URLSearchParams(location.search);
      var tst = tagStateOf(relPath(), tsp);
      // A page number on a saved listing (the page-jump dialog) is that file.
      if (!tst.q && files.has(tagFile(tst))) {
        if (tagFile(tst) !== relPath()) location.replace(ROOT + tagFile(tst));
      } else showTags(tst);
    }
    if (document.getElementById('collections-page') && location.search) {
      filterCollections(new URLSearchParams(location.search).get('q') || '');
    }
  });

  window.__demo = { url: url, search: search, runSearch: runSearch, rewriteHTML: rewriteHTML, notice: notice, tagStateOf: tagStateOf, tagRows: tagRows, loadTagRows: loadTagRows };
})();
