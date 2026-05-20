export interface ScopeCssOptions {
    excludeSelector?: string;
}

/**
 * Scopes raw CSS text to a theme class and optional exclusion selector.
 * @param cssText The CSS text to scope.
 * @param themeClass The root theme class to prepend to selectors.
 * @param options Optional selector exclusions to append as :not(...) guards.
 * @returns The scoped CSS text.
 */
export function scopeCssText(
    cssText: string,
    themeClass: string = '',
    options: ScopeCssOptions = {},
): string {
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
                const nested = scopeCssText(body, themeClass, options);
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

/**
 * Scopes a selector list to a theme class and optional exclusion selector.
 * @param selectorText The selector list to scope.
 * @param themeClass The root theme class to prepend to selectors.
 * @param excludeSelector Optional selector exclusions to append as :not(...) guards.
 * @returns The scoped selector list.
 */
export function scopeSelector(selectorText: string, themeClass: string, excludeSelector?: string): string {
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

function indent(value: string): string {
    return value.split('\n').map(line => `    ${line}`).join('\n');
}
