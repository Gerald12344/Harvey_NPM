import { fetchLogger } from '../utils/logger';
import { fetchSettings } from '../utils/settings';
import express, { Express } from 'express';
import { join, resolve } from 'path';
const logger = fetchLogger();

let functionsRoute: {
    [key: string]: {
        route: string;
        exact: boolean;
    };
} = {};

let Global: string[] = [];

let SSR_GLOBAL_BODY = '';
let SSR_GLOBAL_HEAD = '';
let SSR_CACHE: {
    [key: string]: {
        exact: boolean;
        head: string;
        body: string;
    };
} = {};

export function SetupSSR(codeCompiled: string) {
    let settings = fetchSettings();
    if (settings.debug) {
        logger?.log('warn', 'Loading SSR code');
    }
    let regex = /(?<=\/\* ROUTER POINT FOR SSR \*\/)(.*)(?=\/\* END OF ROUTER POINT FOR SSR \*\/)/gm;

    let found = codeCompiled.match(regex);

    if (found === null) return;
    let routerManager = found[0];

    let lined = routerManager.replace(/;/g, ';\n').split('\n');
    lined.filter((e) => {
        if (e.includes('function')) return false;
        if (e.includes('RouterPoint')) {
            let split = e
                .replace(/\s/g, '')
                .replace(/RouterPoint\(/g, '')
                .replace(/\)/g, '')
                .split(',');
            functionsRoute[split[0]] = {
                route: split[2],
                exact: split[1] === 'true',
            };
        } else {
            Global.push(e.split('(')[0]);
        }
        return true;
    });

    Global.forEach((e) => {
        let AST = GenerateASTForPage(codeCompiled, e);
        let HTML = HtmlToAst(AST);
        SSR_GLOBAL_BODY += HTML.body;
        SSR_GLOBAL_HEAD += HTML.head;
    });

    Object.entries(functionsRoute).forEach(([key, value]) => {
        let AST = GenerateASTForPage(codeCompiled, value.route.replace(/;/g, '').replace(/}/g, ''));
        let HTML = HtmlToAst(AST);
        SSR_CACHE[key.replace(/\'/g, '')] = {
            exact: value.exact,
            ...HTML,
        };
    });
}

export function GenerateASTForPage(code: String, functionName: String) {
    try {
        let hierachy = eval(
            `
        let window = {};
        let Hydration = true;
        window.addEventListener = () => {};
        let logger = console.log;
        console.log = () => {};
  ` +
                code +
                `
    ${functionName}();
    console.log = logger;
    hierachy
  `,
        );

        return { body: { type: 'body' }, head: { type: 'head' }, ...hierachy };
    } catch (e) {
        logger?.error(e);
    }
}

interface AST_HTML {
    opener: string;
    children: AST_HTML[];
    parent: string;
    closer: string;
}

function HtmlToAst(ast: { [key: string]: { type: string; parent: string; className: string; text: string } }) {
    let html_ed: {
        [key: string]: AST_HTML;
    } = {};

    Object.entries(ast).forEach(([id, value]) => {
        html_ed[id] = {
            opener: `<${value.type} class="${value.className ?? ''}" id="${id ?? ''}">${value.text ?? ''}`,
            children: [],
            parent: value.parent,
            closer: `</${value.type}>`,
        };
    });

    Object.entries(html_ed).forEach(([id, value]) => {
        if (html_ed[value.parent] === undefined) return;
        html_ed[value.parent].children.push(value);
    });

    // explore tree
    let recursiveFunc = (child: AST_HTML): string => {
        if (child === undefined) return '';
        if (child.children === undefined || child.children.length === 0) {
            return child.opener + child.closer;
        } else {
            return child.opener + child.children.map((e) => recursiveFunc(e)).join('') + child.closer;
        }
    };

    return {
        body: recursiveFunc(html_ed['body']).replace(`<body class="" id="body">`, '').replace(`</body>`, ''),
        head: recursiveFunc(html_ed['head']).replace(`<head class="" id="head">`, '').replace(`</head>`, ''),
    };
}

export function injectHTML(app: Express, HTML: string) {
    let settings = fetchSettings();
    app.disable('view cache');

    Object.entries(SSR_CACHE).forEach(([key, value]) => {
        app.get(key, (req, res) => {
            let bodyMain = value?.body ?? '';
            let headMain = value?.head ?? '';
            let newHtml;
            newHtml = HTML.replace('<!-- {{%BODY_FOR_SSR%}} -->', SSR_GLOBAL_BODY + bodyMain);
            newHtml = newHtml.replace('<!-- {{%HEAD_FOR_SSR%}} -->', SSR_GLOBAL_HEAD + headMain);

            res.status(200);
            res.send(newHtml);
        });
    });

    app.get('*', (req, res, next) => {
        let url = req.url.split('/');
        let last = url[url.length - 1];

        if (last.includes('.')) {
            next();
            return;
        } else {
            res.send(HTML);
        }
    });

    app.use(express.static(join(resolve('./'), `${settings.outputFolder}`)));
}
