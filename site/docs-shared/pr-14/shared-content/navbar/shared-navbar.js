class SharedNavbar extends HTMLElement {
    connectedCallback() {
        fetch('/docs-shared/pr-14/shared-content/{{{MODULE}}}/navbar.html')
            .then(res => res.text())
            .then(html => {
                this.innerHTML = html;
                this.dispatchEvent(new CustomEvent('liara-navbar-ready', { bubbles: true }));
            })
            .catch(err => console.error('shared-navbar: fetch failed', err));
    }
}
customElements.define('shared-navbar', SharedNavbar);