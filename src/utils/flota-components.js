/**
 * Flota UI - Web Components
 * 为插件提供开箱即用的原生 Web Components
 * 
 * 使用方法：
 * <fn-button variant="primary">按钮</fn-button>
 * <fn-card>卡片内容</fn-card>
 * 
 * @version 1.0.0
 * @requires UI Bridge Phase 1 (CSS Variables)
 */

/**
 * Flota Button Component
 * 使用方法：
 * <fn-button variant="primary|secondary|outlined|text" size="sm|md|lg">按钮文字</fn-button>
 */
class FlotaButton extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
    this.setupEventListeners()
  }

  static get observedAttributes() {
    return ['variant', 'size', 'disabled', 'block', 'icon']
  }

  attributeChangedCallback() {
    this.render()
  }

  render() {
    const variant = this.getAttribute('variant') || 'primary'
    const size = this.getAttribute('size') || 'md'
    const disabled = this.hasAttribute('disabled')
    const block = this.hasAttribute('block')
    const icon = this.hasAttribute('icon')

    const classes = [
      'fn-btn',
      `fn-btn-${variant}`,
      size !== 'md' ? `fn-btn-${size}` : '',
      block ? 'fn-btn-block' : '',
      icon ? 'fn-btn-icon' : ''
    ].filter(Boolean).join(' ')

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }
        
        button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: var(--fn-spacing-1, 8px) var(--fn-spacing-2, 16px);
          border: none;
          border-radius: var(--fn-shape-borderRadius, 4px);
          font-family: var(--fn-font-family, sans-serif);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.1s ease;
          user-select: none;
          white-space: nowrap;
          background: var(--fn-primary-main, #1976d2);
          color: var(--fn-primary-contrastText, white);
        }

        button:hover:not(:disabled) {
          background: var(--fn-primary-dark, #1565c0);
          box-shadow: var(--fn-shadow-4, 0 4px 8px rgba(0,0,0,0.2));
        }

        button:active:not(:disabled) {
          transform: translateY(1px);
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .fn-btn-secondary {
          background: var(--fn-secondary-main, #dc004e);
          color: var(--fn-secondary-contrastText, white);
        }

        .fn-btn-secondary:hover:not(:disabled) {
          background: var(--fn-secondary-dark, #c51162);
        }

        .fn-btn-outlined {
          background: transparent;
          color: var(--fn-primary-main, #1976d2);
          border: 1px solid var(--fn-primary-main, #1976d2);
        }

        .fn-btn-outlined:hover:not(:disabled) {
          background: var(--fn-action-hover, rgba(25, 118, 210, 0.08));
        }

        .fn-btn-text {
          background: transparent;
          color: var(--fn-primary-main, #1976d2);
        }

        .fn-btn-text:hover:not(:disabled) {
          background: var(--fn-action-hover, rgba(25, 118, 210, 0.08));
        }

        .fn-btn-sm {
          padding: 4px 12px;
          font-size: 13px;
        }

        .fn-btn-lg {
          padding: 12px 24px;
          font-size: 15px;
        }

        .fn-btn-block {
          width: 100%;
        }

        .fn-btn-icon {
          padding: var(--fn-spacing-1, 8px);
          border-radius: 50%;
        }
      </style>
      <button class="${classes}" ${disabled ? 'disabled' : ''}>
        <slot></slot>
      </button>
    `
  }

  setupEventListeners() {
    const button = this.shadowRoot.querySelector('button')
    button.addEventListener('click', (e) => {
      if (!this.hasAttribute('disabled')) {
        this.dispatchEvent(new CustomEvent('fn-click', {
          bubbles: true,
          composed: true,
          detail: { originalEvent: e }
        }))
      }
    })
  }
}

/**
 * Flota Card Component
 * 使用方法：
 * <fn-card hover>
 *   <div slot="title">标题</div>
 *   <div slot="content">内容</div>
 * </fn-card>
 */
class FlotaCard extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
  }

  static get observedAttributes() {
    return ['hover', 'padding']
  }

  attributeChangedCallback() {
    this.render()
  }

  render() {
    const hover = this.hasAttribute('hover')
    const padding = this.getAttribute('padding') || 'md'

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .card {
          background: var(--fn-background-paper, white);
          border-radius: var(--fn-shape-borderRadius, 4px);
          box-shadow: var(--fn-shadow-2, 0 2px 4px rgba(0,0,0,0.1));
          overflow: hidden;
          transition: all 0.1s ease;
        }

        .card.hover:hover {
          box-shadow: var(--fn-shadow-8, 0 8px 16px rgba(0,0,0,0.15));
          transform: translateY(-2px);
        }

        .card-body {
          padding: var(--fn-spacing-3, 24px);
        }

        .card-body.sm {
          padding: var(--fn-spacing-2, 16px);
        }

        .card-body.lg {
          padding: var(--fn-spacing-4, 32px);
        }

        .card-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--fn-text-primary, rgba(0,0,0,0.87));
          margin-bottom: var(--fn-spacing-2, 16px);
        }

        .card-content {
          font-size: 14px;
          color: var(--fn-text-secondary, rgba(0,0,0,0.6));
          line-height: 1.6;
        }
      </style>
      <div class="card ${hover ? 'hover' : ''}">
        <div class="card-body ${padding}">
          <div class="card-title">
            <slot name="title"></slot>
          </div>
          <div class="card-content">
            <slot></slot>
          </div>
        </div>
      </div>
    `
  }
}

/**
 * Flota Input Component
 * 使用方法：
 * <fn-input placeholder="请输入..." value="" error></fn-input>
 */
class FlotaInput extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
    this.setupEventListeners()
  }

  static get observedAttributes() {
    return ['value', 'placeholder', 'type', 'disabled', 'error']
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'value') {
      const input = this.shadowRoot.querySelector('input')
      if (input && input.value !== newValue) {
        input.value = newValue || ''
      }
    } else {
      this.render()
    }
  }

  render() {
    const value = this.getAttribute('value') || ''
    const placeholder = this.getAttribute('placeholder') || ''
    const type = this.getAttribute('type') || 'text'
    const disabled = this.hasAttribute('disabled')
    const error = this.hasAttribute('error')

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        input {
          width: 100%;
          padding: var(--fn-spacing-1, 8px) var(--fn-spacing-2, 16px);
          border: 1px solid var(--fn-divider, rgba(0,0,0,0.12));
          border-radius: var(--fn-shape-borderRadius, 4px);
          font-family: var(--fn-font-family, sans-serif);
          font-size: 14px;
          color: var(--fn-text-primary, rgba(0,0,0,0.87));
          background: var(--fn-background-paper, white);
          transition: all 0.1s ease;
          box-sizing: border-box;
        }

        input:focus {
          outline: none;
          border-color: var(--fn-primary-main, #1976d2);
          box-shadow: 0 0 0 2px var(--fn-primary-light, rgba(25, 118, 210, 0.2));
        }

        input:disabled {
          background: var(--fn-action-disabledBackground, rgba(0,0,0,0.12));
          color: var(--fn-text-disabled, rgba(0,0,0,0.38));
          cursor: not-allowed;
        }

        input.error {
          border-color: var(--fn-error-main, #f44336);
        }

        input.error:focus {
          box-shadow: 0 0 0 2px var(--fn-error-light, rgba(244, 67, 54, 0.2));
        }
      </style>
      <input
        type="${type}"
        value="${value}"
        placeholder="${placeholder}"
        class="${error ? 'error' : ''}"
        ${disabled ? 'disabled' : ''}
      />
    `
  }

  setupEventListeners() {
    const input = this.shadowRoot.querySelector('input')
    
    input.addEventListener('input', (e) => {
      this.setAttribute('value', e.target.value)
      this.dispatchEvent(new CustomEvent('fn-input', {
        bubbles: true,
        composed: true,
        detail: { value: e.target.value }
      }))
    })

    input.addEventListener('change', (e) => {
      this.dispatchEvent(new CustomEvent('fn-change', {
        bubbles: true,
        composed: true,
        detail: { value: e.target.value }
      }))
    })

    input.addEventListener('focus', () => {
      this.dispatchEvent(new CustomEvent('fn-focus', {
        bubbles: true,
        composed: true
      }))
    })

    input.addEventListener('blur', () => {
      this.dispatchEvent(new CustomEvent('fn-blur', {
        bubbles: true,
        composed: true
      }))
    })
  }

  get value() {
    return this.shadowRoot.querySelector('input').value
  }

  set value(val) {
    this.setAttribute('value', val)
  }
}

/**
 * Flota Chip Component
 * 使用方法：
 * <fn-chip variant="primary|success|error|warning|info">标签</fn-chip>
 */
class FlotaChip extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
  }

  static get observedAttributes() {
    return ['variant', 'deletable']
  }

  attributeChangedCallback() {
    this.render()
  }

  render() {
    const variant = this.getAttribute('variant') || 'default'
    const deletable = this.hasAttribute('deletable')

    const variantStyles = {
      default: 'background: var(--fn-action-hover, rgba(0,0,0,0.08)); color: var(--fn-text-primary, rgba(0,0,0,0.87));',
      primary: 'background: var(--fn-primary-light, #e3f2fd); color: var(--fn-primary-dark, #1565c0);',
      success: 'background: var(--fn-success-light, #e8f5e9); color: var(--fn-success-dark, #388e3c);',
      error: 'background: var(--fn-error-light, #ffebee); color: var(--fn-error-dark, #d32f2f);',
      warning: 'background: var(--fn-warning-light, #fff3e0); color: var(--fn-warning-dark, #f57c00);',
      info: 'background: var(--fn-info-light, #e3f2fd); color: var(--fn-info-dark, #1976d2);'
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 12px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 500;
          ${variantStyles[variant] || variantStyles.default}
        }

        .delete-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          padding: 0;
          margin-left: 4px;
          border: none;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          opacity: 0.7;
          transition: opacity 0.1s;
        }

        .delete-btn:hover {
          opacity: 1;
        }
      </style>
      <div class="chip">
        <slot></slot>
        ${deletable ? '<button class="delete-btn" aria-label="删除">×</button>' : ''}
      </div>
    `

    if (deletable) {
      const deleteBtn = this.shadowRoot.querySelector('.delete-btn')
      deleteBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('fn-delete', {
          bubbles: true,
          composed: true
        }))
      })
    }
  }
}

/**
 * Flota Alert Component
 * 使用方法：
 * <fn-alert variant="success|error|warning|info">提示信息</fn-alert>
 */
class FlotaAlert extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
  }

  static get observedAttributes() {
    return ['variant']
  }

  attributeChangedCallback() {
    this.render()
  }

  render() {
    const variant = this.getAttribute('variant') || 'info'

    const variantStyles = {
      success: {
        bg: 'var(--fn-success-light, #e8f5e9)',
        border: 'var(--fn-success-main, #4caf50)',
        color: 'var(--fn-success-dark, #388e3c)'
      },
      error: {
        bg: 'var(--fn-error-light, #ffebee)',
        border: 'var(--fn-error-main, #f44336)',
        color: 'var(--fn-error-dark, #d32f2f)'
      },
      warning: {
        bg: 'var(--fn-warning-light, #fff3e0)',
        border: 'var(--fn-warning-main, #ff9800)',
        color: 'var(--fn-warning-dark, #f57c00)'
      },
      info: {
        bg: 'var(--fn-info-light, #e3f2fd)',
        border: 'var(--fn-info-main, #2196f3)',
        color: 'var(--fn-info-dark, #1976d2)'
      }
    }

    const style = variantStyles[variant] || variantStyles.info

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .alert {
          padding: var(--fn-spacing-2, 16px);
          border-radius: var(--fn-shape-borderRadius, 4px);
          border-left: 4px solid ${style.border};
          background: ${style.bg};
          color: ${style.color};
          margin-bottom: var(--fn-spacing-2, 16px);
        }
      </style>
      <div class="alert">
        <slot></slot>
      </div>
    `
  }
}

/**
 * Flota Spinner Component
 * 使用方法：
 * <fn-spinner size="sm|md|lg"></fn-spinner>
 */
class FlotaSpinner extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
  }

  static get observedAttributes() {
    return ['size']
  }

  attributeChangedCallback() {
    this.render()
  }

  render() {
    const size = this.getAttribute('size') || 'md'
    const sizes = { sm: 20, md: 40, lg: 60 }
    const diameter = sizes[size] || sizes.md
    const borderWidth = diameter / 10

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
        }

        .spinner {
          width: ${diameter}px;
          height: ${diameter}px;
          border: ${borderWidth}px solid var(--fn-action-hover, rgba(0,0,0,0.1));
          border-top-color: var(--fn-primary-main, #1976d2);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="spinner"></div>
    `
  }
}

/**
 * 注册所有 Web Components
 */
export function registerFlotaComponents(windowContext = window) {
  if (!windowContext.customElements) {
    console.warn('[Flota Components] 当前环境不支持 Custom Elements')
    return
  }

  const components = [
    ['fn-button', FlotaButton],
    ['fn-card', FlotaCard],
    ['fn-input', FlotaInput],
    ['fn-chip', FlotaChip],
    ['fn-alert', FlotaAlert],
    ['fn-spinner', FlotaSpinner]
  ]

  components.forEach(([name, component]) => {
    try {
      if (!windowContext.customElements.get(name)) {
        windowContext.customElements.define(name, component)
        console.log(`[Flota Components] 已注册: ${name}`)
      }
    } catch (error) {
      console.error(`[Flota Components] 注册失败: ${name}`, error)
    }
  })
}
