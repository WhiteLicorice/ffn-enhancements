type ColorMap = Record<string, string>;

const COLOR_VALUE_RE = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\(\s*[^)]+\)|\b(?:black|white|gray|grey|red|green|blue|yellow|transparent)\b/gi;
const COLOR_PROPERTY_RE = /(^color$|color$|^background$|^background-color$|^border$|^border-color$|^outline$|^outline-color$|^box-shadow$|^text-shadow$|^fill$|^stroke$)/i;
const OWN_STYLE_ID_RE = /^(ffne-|ffe-|ffn-enhancements)/;

const NAMED_COLORS: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    gray: '#808080',
    grey: '#808080',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
};

interface ReplacementResult {
    value: string;
    changed: boolean;
}

interface DeclarationOverride {
    property: string;
    value: string;
    priority: string;
}

interface ScanOptions {
    excludeSelector?: string;
}

export const CssScanner = {
    _cache: new Map<string, string>(),

    scanAndOverride(
        colorMap: ColorMap,
        themeClass: string = '',
        rootDocument: Document = document,
        options: ScanOptions = {},
    ): string {
        const normalizedMap = normalizeColorMap(colorMap);
        if (Object.keys(normalizedMap).length === 0) return '';

        const cacheKey = [
            rootDocument.location?.pathname || 'document',
            themeClass,
            options.excludeSelector || '',
            JSON.stringify(normalizedMap),
        ].join('|');
        const cached = this._cache.get(cacheKey);
        if (cached !== undefined) return cached;

        const output: string[] = [];
        for (const sheet of Array.from(rootDocument.styleSheets)) {
            if (shouldSkipSheet(sheet)) continue;

            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                continue;
            }

            output.push(...scanRules(rules, normalizedMap, themeClass, options));
        }

        const css = output.join('\n\n');
        this._cache.set(cacheKey, css);
        return css;
    },

    scopeCssText(
        cssText: string,
        themeClass: string = '',
        options: ScanOptions = {},
    ): string {
        if (!cssText.trim()) return '';

        const scratchDocument = document.implementation.createHTMLDocument('');
        const style = scratchDocument.createElement('style');
        style.textContent = cssText;
        scratchDocument.head.appendChild(style);

        const rules = style.sheet?.cssRules;
        if (!rules) return scopeFlatCssText(cssText, themeClass, options);

        const scopedCss = serializeRules(rules, themeClass, options).join('\n\n');
        return scopedCss || scopeFlatCssText(cssText, themeClass, options);
    },

    clearCache(): void {
        this._cache.clear();
    },
};

function scanRules(
    rules: CSSRuleList,
    colorMap: ColorMap,
    themeClass: string,
    options: ScanOptions,
    wrappers: string[] = [],
): string[] {
    const output: string[] = [];

    for (const rule of Array.from(rules)) {
        if (isStyleRule(rule)) {
            const declarations = getDeclarationOverrides(rule.style, colorMap);
            if (declarations.length === 0) continue;

            const selector = scopeSelector(rule.selectorText, themeClass, options.excludeSelector);
            const body = declarations
                .map(({ property, value, priority }) => `    ${property}: ${value}${priority ? ` !${priority}` : ''};`)
                .join('\n');
            const cssRule = `${selector} {\n${body}\n}`;
            output.push(wrapRule(cssRule, wrappers));
            continue;
        }

        if (isGroupingRule(rule)) {
            const prelude = getGroupingPrelude(rule);
            output.push(...scanRules(rule.cssRules, colorMap, themeClass, options, [...wrappers, prelude]));
        }
    }

    return output;
}

function serializeRules(
    rules: CSSRuleList,
    themeClass: string,
    options: ScanOptions,
    wrappers: string[] = [],
): string[] {
    const output: string[] = [];

    for (const rule of Array.from(rules)) {
        if (isStyleRule(rule)) {
            const selector = scopeSelector(rule.selectorText, themeClass, options.excludeSelector);
            const declarations = serializeStyleDeclarations(rule.style);
            const cssRule = `${selector} {\n${declarations}\n}`;
            output.push(wrapRule(cssRule, wrappers));
            continue;
        }

        if (isGroupingRule(rule)) {
            const prelude = getGroupingPrelude(rule);
            output.push(...serializeRules(rule.cssRules, themeClass, options, [...wrappers, prelude]));
        }
    }

    return output;
}

function getDeclarationOverrides(style: CSSStyleDeclaration, colorMap: ColorMap): DeclarationOverride[] {
    const declarations: DeclarationOverride[] = [];

    for (let i = 0; i < style.length; i++) {
        const property = style.item(i);
        if (!COLOR_PROPERTY_RE.test(property)) continue;

        const originalValue = style.getPropertyValue(property);
        if (!originalValue) continue;

        const result = replaceColors(originalValue, colorMap);
        if (!result.changed) continue;

        declarations.push({
            property,
            value: result.value,
            priority: style.getPropertyPriority(property),
        });
    }

    return declarations;
}

function replaceColors(value: string, colorMap: ColorMap): ReplacementResult {
    let changed = false;
    const nextValue = value.replace(COLOR_VALUE_RE, (match) => {
        const parsed = parseColor(match);
        if (!parsed) return match;

        const mapped = colorMap[parsed.hex];
        if (!mapped) return match;

        changed = true;
        if (parsed.alpha !== undefined && parsed.alpha < 1) {
            return withAlpha(mapped, parsed.alpha);
        }
        return mapped;
    });

    return { value: nextValue, changed };
}

function parseColor(value: string): { hex: string; alpha?: number } | null {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'transparent') return null;

    if (trimmed.startsWith('#')) {
        return parseHexColor(trimmed);
    }

    if (trimmed.startsWith('rgb')) {
        return parseRgbColor(trimmed);
    }

    const named = NAMED_COLORS[trimmed];
    return named ? { hex: named } : null;
}

function parseHexColor(value: string): { hex: string; alpha?: number } | null {
    const raw = value.slice(1);
    if (![3, 4, 6, 8].includes(raw.length)) return null;

    const expanded = raw.length <= 4
        ? raw.split('').map(char => char + char).join('')
        : raw;
    const hex = `#${expanded.slice(0, 6)}`.toLowerCase();
    const alphaHex = expanded.length === 8 ? expanded.slice(6, 8) : '';
    const alpha = alphaHex ? Number.parseInt(alphaHex, 16) / 255 : undefined;

    return { hex, alpha };
}

function parseRgbColor(value: string): { hex: string; alpha?: number } | null {
    const body = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
    const parts = body.split(',').map(part => part.trim());
    if (parts.length < 3) return null;

    const channels = parts.slice(0, 3).map(parseRgbChannel);
    if (channels.some(channel => channel === null)) return null;

    const alpha = parts[3] !== undefined ? parseAlpha(parts[3]) : undefined;
    return {
        hex: rgbToHex(channels[0]!, channels[1]!, channels[2]!),
        alpha,
    };
}

function parseRgbChannel(value: string): number | null {
    if (value.endsWith('%')) {
        const percent = Number.parseFloat(value);
        if (!Number.isFinite(percent)) return null;
        return clamp(Math.round(percent * 2.55), 0, 255);
    }

    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return null;
    return clamp(Math.round(numeric), 0, 255);
}

function parseAlpha(value: string): number | undefined {
    if (value.endsWith('%')) {
        const percent = Number.parseFloat(value);
        return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : undefined;
    }

    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : undefined;
}

function normalizeColorMap(colorMap: ColorMap): ColorMap {
    const normalized: ColorMap = {};

    Object.entries(colorMap).forEach(([from, to]) => {
        const parsed = parseColor(from);
        if (!parsed) return;
        normalized[parsed.hex] = normalizeOutputColor(to);
    });

    return normalized;
}

function normalizeOutputColor(value: string): string {
    const parsed = parseColor(value);
    return parsed?.hex || value;
}

function rgbToHex(red: number, green: number, blue: number): string {
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function toHex(value: number): string {
    return value.toString(16).padStart(2, '0');
}

function withAlpha(hex: string, alpha: number): string {
    const parsed = parseHexColor(hex);
    if (!parsed) return hex;

    const red = Number.parseInt(parsed.hex.slice(1, 3), 16);
    const green = Number.parseInt(parsed.hex.slice(3, 5), 16);
    const blue = Number.parseInt(parsed.hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function shouldSkipSheet(sheet: StyleSheet): boolean {
    if (sheet.disabled) return true;

    const owner = (sheet as CSSStyleSheet & { ownerNode?: Element }).ownerNode;
    const id = owner?.id || '';
    return OWN_STYLE_ID_RE.test(id);
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
    return 'selectorText' in rule && 'style' in rule;
}

function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
    return 'cssRules' in rule && !isStyleRule(rule);
}

function getGroupingPrelude(rule: CSSRule): string {
    if ('conditionText' in rule && rule.cssText.trim().startsWith('@media')) {
        return `@media ${rule.conditionText}`;
    }
    if ('conditionText' in rule && rule.cssText.trim().startsWith('@supports')) {
        return `@supports ${rule.conditionText}`;
    }
    return rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
}

function scopeSelector(selectorText: string, themeClass: string, excludeSelector?: string): string {
    const exclusionSuffix = buildExclusionSuffix(excludeSelector);

    return selectorText
        .split(',')
        .map(selector => {
            const trimmed = selector.trim();
            const themed = applyThemeScope(trimmed, themeClass);
            return exclusionSuffix ? appendSelectorSuffix(themed, exclusionSuffix) : themed;
        })
        .join(', ');
}

function applyThemeScope(selector: string, themeClass: string): string {
    if (!themeClass) return selector;
    if (selector === 'html') return `html.${themeClass}`;
    if (selector.startsWith('html.')) return selector.replace(/^html/, `html.${themeClass}`);
    if (selector.startsWith('html ')) return selector.replace(/^html/, `html.${themeClass}`);
    return `html.${themeClass} ${selector}`;
}

function buildExclusionSuffix(excludeSelector?: string): string {
    if (!excludeSelector) return '';
    return excludeSelector
        .split(',')
        .map(selector => selector.trim())
        .filter(Boolean)
        .map(selector => `:not(${selector})`)
        .join('');
}

function appendSelectorSuffix(selector: string, suffix: string): string {
    const pseudoElementIndex = getPseudoElementIndex(selector);
    if (pseudoElementIndex === -1) {
        return `${selector}${suffix}`;
    }

    return `${selector.slice(0, pseudoElementIndex)}${suffix}${selector.slice(pseudoElementIndex)}`;
}

function getPseudoElementIndex(selector: string): number {
    const modernIndex = selector.lastIndexOf('::');
    if (modernIndex !== -1) return modernIndex;

    const legacyMatch = /:(before|after|first-letter|first-line)(?=\s|$|:)/.exec(selector);
    return legacyMatch?.index ?? -1;
}

function serializeStyleDeclarations(style: CSSStyleDeclaration): string {
    const declarations: string[] = [];
    for (let i = 0; i < style.length; i++) {
        const property = style.item(i);
        const value = style.getPropertyValue(property);
        const priority = style.getPropertyPriority(property);
        declarations.push(`    ${property}: ${value}${priority ? ` !${priority}` : ''};`);
    }
    return declarations.join('\n');
}

function scopeFlatCssText(cssText: string, themeClass: string, options: ScanOptions): string {
    const output: string[] = [];
    let cursor = 0;

    while (cursor < cssText.length) {
        const openIndex = findNextTopLevelBrace(cssText, cursor);
        if (openIndex === -1) break;

        const closeIndex = findMatchingBrace(cssText, openIndex);
        if (closeIndex === -1) {
            output.push(cssText.slice(cursor).trim());
            break;
        }

        const prelude = cssText.slice(cursor, openIndex);
        const body = cssText.slice(openIndex + 1, closeIndex);
        const { leading, remainder } = splitLeadingComments(prelude);
        const trimmedPrelude = remainder.trim();

        if (trimmedPrelude) {
            if (trimmedPrelude.startsWith('@media') || trimmedPrelude.startsWith('@supports')) {
                const nested = scopeFlatCssText(body, themeClass, options);
                output.push(`${leading}${trimmedPrelude} {\n${indent(nested)}\n}`);
            } else if (trimmedPrelude.startsWith('@')) {
                output.push(`${leading}${trimmedPrelude} {\n${indentBlockBody(body)}\n}`);
            } else {
                const selector = scopeSelector(trimmedPrelude, themeClass, options.excludeSelector);
                output.push(`${leading}${selector} {\n${indentBlockBody(body)}\n}`);
            }
        }

        cursor = closeIndex + 1;
    }

    return output.filter(Boolean).join('\n\n');
}

function indentBlockBody(body: string): string {
    return body
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `    ${line}`)
        .join('\n');
}

function splitLeadingComments(value: string): { leading: string; remainder: string } {
    let index = 0;

    while (index < value.length) {
        const char = value[index];
        if (/\s/.test(char)) {
            index++;
            continue;
        }

        if (value.startsWith('/*', index)) {
            const end = value.indexOf('*/', index + 2);
            if (end === -1) {
                return { leading: value, remainder: '' };
            }
            index = end + 2;
            continue;
        }

        break;
    }

    return {
        leading: value.slice(0, index),
        remainder: value.slice(index),
    };
}

function findNextTopLevelBrace(value: string, startIndex: number): number {
    let index = startIndex;
    while (index < value.length) {
        const skipped = skipCommentOrString(value, index);
        if (skipped !== index) {
            index = skipped;
            continue;
        }

        if (value[index] === '{') {
            return index;
        }

        index++;
    }

    return -1;
}

function findMatchingBrace(value: string, openIndex: number): number {
    let depth = 0;
    let index = openIndex;

    while (index < value.length) {
        const skipped = skipCommentOrString(value, index);
        if (skipped !== index) {
            index = skipped;
            continue;
        }

        if (value[index] === '{') {
            depth++;
        } else if (value[index] === '}') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }

        index++;
    }

    return -1;
}

function skipCommentOrString(value: string, index: number): number {
    if (value.startsWith('/*', index)) {
        const end = value.indexOf('*/', index + 2);
        return end === -1 ? value.length : end + 2;
    }

    if (value[index] === '"' || value[index] === '\'') {
        const quote = value[index];
        let current = index + 1;
        while (current < value.length) {
            if (value[current] === '\\') {
                current += 2;
                continue;
            }

            if (value[current] === quote) {
                return current + 1;
            }

            current++;
        }

        return value.length;
    }

    return index;
}

function wrapRule(cssRule: string, wrappers: string[]): string {
    return wrappers.reduceRight((inner, wrapper) => `${wrapper} {\n${indent(inner)}\n}`, cssRule);
}

function indent(value: string): string {
    return value.split('\n').map(line => `    ${line}`).join('\n');
}
