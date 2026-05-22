import { ThemeManager } from '../modules/ThemeManager';
import { markFfneUiRoot } from './ffneUi';

export type ConfirmRetryChoice = 'retry' | 'build' | 'cancel';

export function confirmRetryDialog(
    failedIndices: number[],
    chapterNames: string[],
): Promise<ConfirmRetryChoice> {
    ThemeManager.ensureComponentStyles();

    const backdrop = markFfneUiRoot(document.createElement('div'));
    backdrop.className = 'ffne-confirm-backdrop';

    const dialog = markFfneUiRoot(document.createElement('div'));
    dialog.className = 'ffne-confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'ffne-confirm-title');

    const header = document.createElement('div');
    header.className = 'ffne-confirm-header';

    const title = document.createElement('h2');
    title.id = 'ffne-confirm-title';
    title.className = 'ffne-confirm-title';
    title.textContent = 'Retry failed chapters?';
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'ffne-confirm-body';

    const intro = document.createElement('p');
    intro.className = 'ffne-confirm-text';
    intro.textContent = 'Some chapters still failed after two passes. Retry them again, build with placeholders, or cancel the download.';
    body.appendChild(intro);

    const list = document.createElement('ul');
    list.className = 'ffne-confirm-list';
    failedIndices.forEach((index, position) => {
        const item = document.createElement('li');
        item.textContent = `Chapter ${index + 1}: ${chapterNames[position] || `Chapter ${index + 1}`}`;
        list.appendChild(item);
    });
    body.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'ffne-confirm-actions';

    const retryBtn = _makeActionButton('Retry again', 'ffne-confirm-btn ffne-confirm-btn-primary');
    const buildBtn = _makeActionButton('Build anyway', 'ffne-confirm-btn');
    const cancelBtn = _makeActionButton('Cancel', 'ffne-confirm-btn');

    actions.append(retryBtn, buildBtn, cancelBtn);
    body.appendChild(actions);

    dialog.append(header, body);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    return new Promise((resolve) => {
        const cleanup = () => {
            document.removeEventListener('keydown', onKeyDown);
            backdrop.remove();
        };

        const finish = (choice: ConfirmRetryChoice) => {
            cleanup();
            resolve(choice);
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                finish('cancel');
            }
        };

        document.addEventListener('keydown', onKeyDown);
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) {
                finish('cancel');
            }
        });

        retryBtn.addEventListener('click', () => finish('retry'));
        buildBtn.addEventListener('click', () => finish('build'));
        cancelBtn.addEventListener('click', () => finish('cancel'));
        retryBtn.focus();
    });
}

function _makeActionButton(label: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}
