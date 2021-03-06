import { tick } from 'svelte';
import { writable, derived } from 'svelte/store';

const specialLinks = /((mailto:\w+)|(tel:\w+)).+/;
const hasLocation = typeof location !== 'undefined';
const hasProcess = typeof process !== 'undefined';
const hasHistory = typeof history !== 'undefined';
const hasWindow = typeof window !== 'undefined';
const subWindow = hasWindow && window !== window.parent;
const sideEffect = hasWindow && hasHistory && !subWindow;
const prefs = {
    query: {
        array: {
            separator: ',',
            format: 'bracket'
        },
        nesting: 3
    },
    sideEffect
};

function pattern(route = '') {
    const { pattern, keys } = parseParams(route);
    const pathname = this.toString(), matches = pattern.exec(pathname);
    if (matches) {
        const params = keys.reduce((p, k, i) => {
            p[k] = convertType(matches[++i], {
                array: { separator: '|', format: 'separator' }
            }) || null;
            return p;
        }, {});
        Object.assign(this, params);
    }
    return !!matches;
}
function parseQuery(str = '', params) {
    return str ? str.replace('?', '')
        .replace(/\+/g, ' ')
        .split('&')
        .filter(Boolean)
        .reduce((obj, p) => {
        let [key, val] = p.split('=');
        key = decodeURIComponent(key || '');
        val = decodeURIComponent(val || '');
        let o = parseKeys(key, val, params);
        obj = Object.keys(o).reduce((obj, key) => {
            if (obj[key]) {
                Array.isArray(obj[key]) ?
                    obj[key] = obj[key].concat(convertType(o[key], params)) :
                    Object.assign(obj[key], convertType(o[key], params));
            }
            else {
                obj[key] = convertType(o[key], params);
            }
            return obj;
        }, obj);
        return obj;
    }, {}) : {};
}
function stringifyQuery(obj = {}, params) {
    const qs = Object.keys(obj)
        .reduce((a, k) => {
        if (obj.hasOwnProperty(k) && isNaN(parseInt(k, 10))) {
            if (Array.isArray(obj[k])) {
                if (params.array.format === 'separator') {
                    a.push(k + '=' + obj[k].join(params.array.separator));
                }
                else {
                    obj[k].forEach(v => a.push(k + '[]=' + encodeURIComponent(v)));
                }
            }
            else if (typeof obj[k] === 'object' && obj[k] !== null) {
                let o = parseKeys(k, obj[k], params);
                a.push(stringifyObject(o));
            }
            else {
                a.push(k + '=' + encodeURIComponent(obj[k]));
            }
        }
        return a;
    }, [])
        .join('&');
    return qs ? `?${qs}` : '';
}
function parseParams(str, loose = false) {
    let arr = str.split('/'), keys = [], pattern = '', c, o, tmp, ext;
    arr[0] || arr.shift();
    while (tmp = arr.shift()) {
        c = tmp[0];
        if (c === '*') {
            keys.push('wild');
            pattern += '/(.*)';
        }
        else if (c === ':') {
            o = tmp.indexOf('?', 1);
            ext = tmp.indexOf('.', 1);
            keys.push(tmp.substring(1, !!~o ? o : !!~ext ? ext : tmp.length));
            pattern += !!~o && !~ext ? '(?:/([^/]+?))?' : '/([^/]+?)';
            if (!!~ext)
                pattern += (!!~o ? '?' : '') + '\\' + tmp.substring(ext);
        }
        else {
            pattern += '/' + tmp;
        }
    }
    return {
        keys,
        pattern: new RegExp('^' + pattern + (loose ? '(?:$|\/)' : '\/?$'), 'i')
    };
}
function convertType(val, params) {
    if (Array.isArray(val)) {
        val[val.length - 1] = convertType(val[val.length - 1], params);
        return val;
    }
    else if (typeof val === 'object') {
        return Object.entries(val).reduce((obj, [k, v]) => {
            obj[k] = convertType(v, params);
            return obj;
        }, {});
    }
    if (val === 'true' || val === 'false') {
        return val === 'true';
    }
    else if (val === 'null') {
        return null;
    }
    else if (val === 'undefined') {
        return undefined;
    }
    else if (val !== '' && !isNaN(Number(val))) {
        return Number(val);
    }
    else if (params.array.format === 'separator' && typeof val === 'string') {
        const arr = val.split(params.array.separator);
        return arr.length > 1 ? arr : val;
    }
    return val;
}
function parseKeys(key, val, params) {
    const brackets = /(\[[^[\]]*])/, child = /(\[[^[\]]*])/g;
    let seg = brackets.exec(key), parent = seg ? key.slice(0, seg.index) : key, keys = [];
    parent && keys.push(parent);
    let i = 0;
    while ((seg = child.exec(key)) && i < params.nesting) {
        i++;
        keys.push(seg[1]);
    }
    seg && keys.push('[' + key.slice(seg.index) + ']');
    return parseObject(keys, val, params);
}
function parseObject(chain, val, params) {
    let leaf = val;
    for (let i = chain.length - 1; i >= 0; --i) {
        let root = chain[i], obj;
        if (root === '[]') {
            obj = [].concat(leaf);
        }
        else {
            obj = {};
            const key = root.charAt(0) === '[' && root.charAt(root.length - 1) === ']' ? root.slice(1, -1) : root, j = parseInt(key, 10);
            if (!isNaN(j) && root !== key && String(j) === key && j >= 0) {
                obj = [];
                obj[j] = convertType(leaf, params);
            }
            else {
                obj[key] = leaf;
            }
        }
        leaf = obj;
    }
    return leaf;
}
function stringifyObject(obj = {}, nesting = '') {
    return Object.entries(obj).map(([key, val]) => {
        if (typeof val === 'object') {
            return stringifyObject(val, nesting ? nesting + `[${key}]` : key);
        }
        else {
            return [nesting + `[${key}]`, val].join('=');
        }
    }).join('&');
}

const pathStore = createStore(path => {
    if (!(path instanceof String))
        path = new String(path);
    return Object.assign(path, { pattern });
});
const queryStore = createStore(query => {
    if (typeof query !== 'string')
        query = stringifyQuery(query, prefs.query);
    return Object.assign(new String(query), parseQuery(query, prefs.query));
});
function createStore(create) {
    return value => {
        const { subscribe, update, set } = writable(create(value));
        return {
            subscribe,
            update: reducer => update(value => create(reducer(value))),
            set: value => set(create(value))
        };
    };
}

const pathname = hasLocation ? location.pathname : '', search = hasLocation ? location.search : '', hash = hasLocation ? location.hash : '';
let popstate = false, len = 0;
const path = pathStore(pathname);
const query = queryStore(search);
const fragment = writable(hash, set => {
    const handler = () => set(location.hash);
    sideEffect && prefs.sideEffect && window.addEventListener('hashchange', handler);
    return () => {
        sideEffect && prefs.sideEffect && window.removeEventListener('hashchange', handler);
    };
});
const state = writable({});
const url = derived([path, query, fragment], ([$path, $query, $fragment], set) => {
    let skip = false;
    tick().then(() => {
        if (skip)
            return;
        set($path.toString() + $query.toString() + $fragment.toString());
    });
    return () => skip = true;
}, pathname + search + hash);
if (sideEffect) {
    url.subscribe($url => {
        if (!prefs.sideEffect)
            return;
        if (popstate)
            return popstate = false;
        history.pushState({}, null, $url);
        len++;
    });
    state.subscribe($state => {
        if (!prefs.sideEffect)
            return;
        const url = location.pathname + location.search + location.hash;
        history.replaceState($state, null, url);
    });
    window.addEventListener('popstate', e => {
        if (!prefs.sideEffect)
            return;
        popstate = true;
        goto(location.href, e.state);
    });
}
function goto(url = '', data) {
    const { pathname, search, hash } = new URL(url, 'file:');
    path.set(pathname);
    query.set(search);
    fragment.set(hash);
    data && tick().then(() => state.set(data));
}
function back(pathname = '/') {
    if (len > 0 && sideEffect && prefs.sideEffect) {
        history.back();
        len--;
    }
    else {
        tick().then(() => path.set(pathname));
    }
}
function click(e) {
    if (!e.target ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        e.button ||
        e.which !== 1 ||
        e.defaultPrevented)
        return;
    const target = e.target;
    const a = target.closest('a');
    if (!a || a.target || a.hasAttribute('download'))
        return;
    const url = a.href;
    if (!url || url.indexOf(location.origin) !== 0 || specialLinks.test(url))
        return;
    e.preventDefault();
    goto(url, Object.assign({}, a.dataset));
}
function submit(e) {
    if (!e.target || e.defaultPrevented)
        return;
    const form = e.target, btn = (e.submitter || isButton(document.activeElement) && document.activeElement);
    let action = form.action, method = form.method, target = form.target;
    if (btn) {
        btn.hasAttribute('formaction') && (action = btn.formAction);
        btn.hasAttribute('formmethod') && (method = btn.formMethod);
        btn.hasAttribute('formtarget') && (target = btn.formTarget);
    }
    if (method && method.toLowerCase() !== 'get')
        return;
    if (target && target.toLowerCase() !== '_self')
        return;
    const { pathname, hash } = new URL(action), search = [], state = {};
    const elements = form.elements, len = elements.length;
    for (let i = 0; i < len; i++) {
        const element = elements[i];
        if (!element.name || element.disabled)
            continue;
        if (['checkbox', 'radio'].includes(element.type) && !element.checked) {
            continue;
        }
        if (isButton(element) && element !== btn) {
            continue;
        }
        if (element.type === 'hidden') {
            state[element.name] = element.value;
            continue;
        }
        search.push(element.name + '=' + element.value);
    }
    let url = (pathname + '?' + search.join('&') + hash);
    url = url[0] !== '/' ? '/' + url : url;
    if (hasProcess && url.match(/^\/[a-zA-Z]:\//)) {
        url = url.replace(/^\/[a-zA-Z]:\//, '/');
    }
    e.preventDefault();
    goto(url, state);
}
function isButton(el) {
    const tagName = el.tagName.toLocaleLowerCase(), type = el.type && el.type.toLocaleLowerCase();
    return (tagName === 'button' || (tagName === 'input' &&
        ['button', 'submit', 'image'].includes(type)));
}

export { back, click, fragment, goto, path, prefs, query, state, submit, url };
