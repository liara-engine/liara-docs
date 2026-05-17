class SharedNavbar extends HTMLElement {
    connectedCallback() {
        fetch('/shared-content/doxygen/navbar.html')
            .then(res => res.text())
            .then(html => {
                this.innerHTML = html;
            });
    }
}

customElements.define('shared-navbar', SharedNavbar);