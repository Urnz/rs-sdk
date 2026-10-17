import { serverId } from './server-context.js';

/** Navigation is local to this document; hashes never change its server context. */
export function mountAdminNavigation(selectView) {
    document.querySelector('#capability-directory-link').href = `capabilities.html?serverId=${encodeURIComponent(serverId)}`;
    const links = [...document.querySelectorAll('#admin-navigation [data-tab]')];
    const picker = document.querySelector('#admin-view-select');
    const title = document.querySelector('#admin-view-title');
    const description = document.querySelector('#admin-view-description');
    const groups = [...document.querySelectorAll('#admin-navigation .navigation-group')];

    for (const group of groups) {
        const options = document.createElement('optgroup');
        options.label = group.querySelector('h2').textContent;
        const card = document.createElement('article');
        card.className = 'workflow-card';
        const heading = document.createElement('h3');
        heading.textContent = options.label;
        card.append(heading);
        for (const link of group.querySelectorAll('[data-tab]')) {
            const option = document.createElement('option');
            option.value = link.dataset.tab;
            option.textContent = link.textContent;
            options.append(option);
            if (link.dataset.tab === 'overview') continue;
            const entry = document.createElement('a');
            entry.href = link.getAttribute('href');
            entry.textContent = link.textContent;
            const hint = document.createElement('p');
            hint.textContent = link.dataset.description;
            card.append(entry, hint);
        }
        picker.append(options);
        document.querySelector('#workflow-cards').append(card);
    }

    function show(focus = false) {
        const link = links.find(entry => entry.getAttribute('href') === location.hash) || links[0];
        if (location.hash !== link.getAttribute('href')) {
            history.replaceState(null, '', `${location.pathname}${location.search}${link.getAttribute('href')}`);
        }
        for (const entry of links) {
            entry.classList.toggle('active', entry === link);
            if (entry === link) entry.setAttribute('aria-current', 'page');
            else entry.removeAttribute('aria-current');
        }
        picker.value = link.dataset.tab;
        title.textContent = link.textContent;
        description.textContent = link.dataset.description;
        document.querySelector('#admin-view-group').textContent = link.closest('.navigation-group').querySelector('h2').textContent;
        selectView(link.dataset.tab);
        if (focus) title.focus();
    }

    picker.addEventListener('change', () => { location.hash = picker.value; });
    window.addEventListener('hashchange', () => show(true));
    document.querySelector('.skip-navigation').addEventListener('click', event => {
        event.preventDefault();
        title.focus();
    });
    // An already selected link still takes keyboard users back to its heading.
    document.querySelector('#admin-navigation').addEventListener('click', event => {
        const link = event.target.closest('a[data-tab]');
        if (link && link.getAttribute('href') === location.hash) title.focus();
    });
    show();
}
