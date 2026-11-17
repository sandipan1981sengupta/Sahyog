/**
 * CloudWheelLoader
 * -----------------------------------------------------------------------
 * A small "tag helper" class that renders the CloudWheel spinning
 * cloud+wheel loader into any container, fully themeable via options.
 *
 * Usage:
 *   const loader = new CloudWheelLoader('#app', {
 *     name: 'Cloudwheel',
 *     subtitle: 'Solution',
 *     background: 'transparent',   // or any CSS color
 *     wheelColor: '#1F3A5F',
 *     spokeColor: '#D9AE45',
 *     cloudColor: '#8FB8CE'
 *   });
 *
 *   loader.mount();     // render + start animating
 *   loader.update({ background: '#000' }); // change options live
 *   loader.destroy();   // remove from DOM
 *
 * Requires cloudwheel-loader.css to be loaded on the page.
 * -----------------------------------------------------------------------
 */
class CloudWheelLoader {
  /**
   * @param {string|HTMLElement} target - CSS selector or element to mount into.
   * @param {Object} [options]
   * @param {string} [options.name="Cloudwheel"]        - Main brand name text.
   * @param {string} [options.subtitle="Solution"]      - Subtitle text under the name.
   * @param {string} [options.background="#0f2036"]     - Stage background. Use "transparent" for none.
   * @param {string} [options.wheelColor="#1F3A5F"]     - Base wheel rim/plate color.
   * @param {string} [options.wheelColorLight]          - Optional lighter shade for the wheel rim gradient (auto-derived if omitted).
   * @param {string} [options.wheelColorDark]           - Optional darker shade for the wheel rim gradient (auto-derived if omitted).
   * @param {string} [options.spokeColor="#D9AE45"]     - Spoke + hub color.
   * @param {string} [options.spokeColorLight]          - Optional lighter shade for the hub gradient (auto-derived if omitted).
   * @param {string} [options.spokeColorDark]           - Optional darker shade for the hub gradient (auto-derived if omitted).
   * @param {string} [options.cloudColor="#8FB8CE"]     - Cloud outline color.
   * @param {string} [options.cloudColorLight="#FFFFFF"]- Lightest stop of the cloud gradient.
   * @param {string} [options.cloudColorDark]           - Darkest stop of the cloud gradient (auto-derived if omitted).
   * @param {string} [options.textColor="#ffffff"]      - Main wordmark color.
   * @param {string} [options.subtextColor]             - Subtitle color (defaults to cloudColor).
   * @param {boolean}[options.showBar=true]              - Show the shimmering loading bar.
   * @param {boolean}[options.fullscreen=false]          - Cover the whole viewport (page-load splash mode).
   * @param {string} [options.size="150px"]              - Emblem width/height.
   * @param {string} [options.wheelSpinSpeed="2.8s"]     - Wheel rotation duration.
   * @param {string} [options.cloudDriftSpeed="3.4s"]    - Cloud left-right drift duration.
   */
  constructor(target, options = {}) {
    this.el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.el) {
      throw new Error(`CloudWheelLoader: target "${target}" not found`);
    }
    this.options = this._normalizeOptions(options);
    this.root = null; // the .cw-loader element, set on mount()
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  /** Render the loader into the target container and start animating. */
  mount() {
    this.root = document.createElement('div');
    this.root.className = 'cw-loader' + (this.options.fullscreen ? ' cw-loader--fullscreen' : '');
    this._applyCssVars(this.root, this.options);
    this.root.innerHTML = this._buildInnerHTML(this.options);
    this.el.appendChild(this.root);
    return this;
  }

  /** Update one or more options live without re-mounting from scratch. */
  update(newOptions = {}) {
    this.options = this._normalizeOptions({ ...this.options, ...newOptions });
    if (!this.root) return this;
    this._applyCssVars(this.root, this.options);

    const word = this.root.querySelector('.cw-loader__word');
    const sub = this.root.querySelector('.cw-loader__subword');
    if (word) word.childNodes[0].nodeValue = this.options.name;
    if (sub) sub.textContent = this.options.subtitle;

    const bar = this.root.querySelector('.cw-loader__bar');
    if (bar) bar.hidden = !this.options.showBar;

    this.root.classList.toggle('cw-loader--fullscreen', !!this.options.fullscreen);
    return this;
  }

  /** Remove the loader from the DOM. */
  destroy() {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Internal helpers                                                  */
  /* ---------------------------------------------------------------- */

  _normalizeOptions(o) {
    const wheelColor = o.wheelColor || '#1F3A5F';
    const spokeColor = o.spokeColor || '#D9AE45';
    const cloudColor = o.cloudColor || '#8FB8CE';

    return {
      name: o.name ?? 'Cloudwheel',
      subtitle: o.subtitle ?? 'Solution',
      background: o.background ?? '#0f2036',

      wheelColor,
      wheelColorLight: o.wheelColorLight || this._lighten(wheelColor, 0.35),
      wheelColorDark: o.wheelColorDark || this._darken(wheelColor, 0.45),

      spokeColor,
      spokeColorLight: o.spokeColorLight || this._lighten(spokeColor, 0.45),
      spokeColorDark: o.spokeColorDark || this._darken(spokeColor, 0.4),

      cloudColor,
      cloudColorLight: o.cloudColorLight || '#FFFFFF',
      cloudColorDark: o.cloudColorDark || this._darken(cloudColor, 0.25),

      textColor: o.textColor ?? '#ffffff',
      subtextColor: o.subtextColor || cloudColor,

      showBar: o.showBar ?? true,
      fullscreen: o.fullscreen ?? false,
      size: o.size ?? '150px',
      wheelSpinSpeed: o.wheelSpinSpeed ?? '2.8s',
      cloudDriftSpeed: o.cloudDriftSpeed ?? '3.4s',
    };
  }

  _applyCssVars(root, opt) {
    root.style.setProperty('--cw-bg', opt.background);
    root.style.setProperty('--cw-cloud-color', opt.cloudColor);
    root.style.setProperty('--cw-cloud-color-light', opt.cloudColorLight);
    root.style.setProperty('--cw-cloud-color-dark', opt.cloudColorDark);
    root.style.setProperty('--cw-wheel-color', opt.wheelColor);
    root.style.setProperty('--cw-wheel-color-light', opt.wheelColorLight);
    root.style.setProperty('--cw-wheel-color-dark', opt.wheelColorDark);
    root.style.setProperty('--cw-spoke-color', opt.spokeColor);
    root.style.setProperty('--cw-spoke-color-light', opt.spokeColorLight);
    root.style.setProperty('--cw-spoke-color-dark', opt.spokeColorDark);
    root.style.setProperty('--cw-text-color', opt.textColor);
    root.style.setProperty('--cw-subtext-color', opt.subtextColor);
    root.style.setProperty('--cw-size', opt.size);
    root.style.setProperty('--cw-wheel-spin-speed', opt.wheelSpinSpeed);
    root.style.setProperty('--cw-cloud-drift-speed', opt.cloudDriftSpeed);

    const rgb = this._hexToRgb(opt.cloudColor);
    if (rgb) root.style.setProperty('--cw-glow-color', `${rgb.r},${rgb.g},${rgb.b}`);
  }

  _buildInnerHTML(opt) {
    const uid = `cw${Math.random().toString(36).slice(2, 9)}`; // unique gradient ids per instance

    return `
      <div class="cw-loader__glow"></div>
      <svg class="cw-loader__svg" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id="${uid}-cloudGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${opt.cloudColorLight}"/>
            <stop offset="45%" stop-color="${opt.cloudColor}"/>
            <stop offset="100%" stop-color="${opt.cloudColorDark}"/>
          </linearGradient>
          <linearGradient id="${uid}-cloudInner" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${opt.cloudColor}"/>
            <stop offset="100%" stop-color="${opt.cloudColorDark}"/>
          </linearGradient>
          <linearGradient id="${uid}-wheelRimGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${opt.wheelColorLight}"/>
            <stop offset="45%" stop-color="${opt.wheelColor}"/>
            <stop offset="100%" stop-color="${opt.wheelColorDark}"/>
          </linearGradient>
          <linearGradient id="${uid}-hubGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${opt.spokeColorLight}"/>
            <stop offset="50%" stop-color="${opt.spokeColor}"/>
            <stop offset="100%" stop-color="${opt.spokeColorDark}"/>
          </linearGradient>
          <radialGradient id="${uid}-hubShine" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#FFFAE6" stop-opacity="0.95"/>
            <stop offset="100%" stop-color="#FFFAE6" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="${uid}-plateShine" cx="30%" cy="25%" r="80%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
          <filter id="${uid}-softShadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#050d18" flood-opacity="0.5"/>
          </filter>
        </defs>

        <circle class="cw-puff cw-puff-a" cx="10" cy="26" r="2.6"/>
        <circle class="cw-puff cw-puff-b" cx="90" cy="20" r="2"/>
        <circle class="cw-puff cw-puff-c" cx="84" cy="32" r="1.3"/>

        <g class="cw-cloud-part" filter="url(#${uid}-softShadow)">
          <path d="M37 26c-7.5 0-13.7 5.4-14.9 12.6-6.9 1.2-12.1 7.1-12.1 14.2 0 8 6.6 14.6 14.8 14.6h40.4c8.9 0 16.1-7.1 16.1-15.8 0-6.9-4.6-12.7-11-14.7C69 28.4 61.2 21.5 52 21.5c-5.5 0-10.5 2.4-14 6.2-.3-.6-.6-1.2-1-1.7z"
                fill="none" stroke="${opt.cloudColorLight}" stroke-opacity="0.2" stroke-width="6" stroke-linejoin="round"/>
          <path d="M37 26c-7.5 0-13.7 5.4-14.9 12.6-6.9 1.2-12.1 7.1-12.1 14.2 0 8 6.6 14.6 14.8 14.6h40.4c8.9 0 16.1-7.1 16.1-15.8 0-6.9-4.6-12.7-11-14.7C69 28.4 61.2 21.5 52 21.5c-5.5 0-10.5 2.4-14 6.2-.3-.6-.6-1.2-1-1.7z"
                fill="none" stroke="url(#${uid}-cloudGrad)" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M37 26c-7.5 0-13.7 5.4-14.9 12.6-6.9 1.2-12.1 7.1-12.1 14.2 0 8 6.6 14.6 14.8 14.6h40.4c8.9 0 16.1-7.1 16.1-15.8 0-6.9-4.6-12.7-11-14.7C69 28.4 61.2 21.5 52 21.5c-5.5 0-10.5 2.4-14 6.2-.3-.6-.6-1.2-1-1.7z"
                fill="none" stroke="url(#${uid}-cloudInner)" stroke-opacity="0.3" stroke-width="0.8" stroke-linejoin="round" transform="translate(0.4,0.5)"/>
        </g>

        <g class="cw-wheel-part" filter="url(#${uid}-softShadow)">
          <circle cx="50" cy="60" r="19.5" fill="${opt.wheelColorDark}"/>
          <circle cx="50" cy="60" r="19.5" fill="url(#${uid}-plateShine)"/>
          <circle cx="50" cy="60" r="19.5" fill="none" stroke="url(#${uid}-wheelRimGrad)" stroke-width="4.6"/>
          <circle cx="50" cy="60" r="19.5" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.9" transform="translate(-0.5,-0.5)"/>
          <g stroke="${opt.spokeColor}" stroke-width="1.4" stroke-linecap="round">
            <line x1="50.000" y1="53.000" x2="50.000" y2="44.000"/>
            <line x1="54.950" y1="55.050" x2="61.314" y2="48.686"/>
            <line x1="57.000" y1="60.000" x2="66.000" y2="60.000"/>
            <line x1="54.950" y1="64.950" x2="61.314" y2="71.314"/>
            <line x1="50.000" y1="67.000" x2="50.000" y2="76.000"/>
            <line x1="45.050" y1="64.950" x2="38.686" y2="71.314"/>
            <line x1="43.000" y1="60.000" x2="34.000" y2="60.000"/>
            <line x1="45.050" y1="55.050" x2="38.686" y2="48.686"/>
          </g>
          <circle cx="50" cy="60" r="6" fill="none" stroke="url(#${uid}-hubGrad)" stroke-width="3.2"/>
          <circle cx="50" cy="60" r="6" fill="url(#${uid}-hubShine)"/>
        </g>
      </svg>

      <div class="cw-loader__text">
        <span class="cw-loader__word">${this._escape(opt.name)}<small class="cw-loader__subword">${this._escape(opt.subtitle)}</small></span>
        <div class="cw-loader__bar" ${opt.showBar ? '' : 'hidden'}></div>
      </div>
    `;
  }

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  _hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  _lighten(hex, amount) {
    const rgb = this._hexToRgb(hex);
    if (!rgb) return hex;
    const l = (c) => Math.round(c + (255 - c) * amount);
    return this._rgbToHex(l(rgb.r), l(rgb.g), l(rgb.b));
  }

  _darken(hex, amount) {
    const rgb = this._hexToRgb(hex);
    if (!rgb) return hex;
    const d = (c) => Math.round(c * (1 - amount));
    return this._rgbToHex(d(rgb.r), d(rgb.g), d(rgb.b));
  }

  _rgbToHex(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
}

// Export for module usage; also available as a global when loaded via <script>.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CloudWheelLoader;
}
