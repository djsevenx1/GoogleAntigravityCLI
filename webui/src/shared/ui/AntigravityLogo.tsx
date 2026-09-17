type AntigravityLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is Google Antigravity. */
const AntigravityLogo = ({ className = 'w-5 h-5' }: AntigravityLogoProps) => (
  <svg
    viewBox="0 0 113 113"
    role="img"
    aria-label="Google Antigravity"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z"
      fill="#3186FF"
    />
    <mask id="mask0_ag_logo" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="13" y="18" width="85" height="78">
      <path
        d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z"
        fill="black"
      />
    </mask>
    <g mask="url(#mask0_ag_logo)">
      <ellipse
        cx="22.7873"
        cy="26.8098"
        rx="22.7873"
        ry="26.8098"
        transform="matrix(-0.112784 0.99362 -0.99362 -0.112781 66.2473 -15.5344)"
        fill="#FFE432"
      />
      <ellipse
        cx="96.491"
        cy="35.1231"
        rx="29.5007"
        ry="30.1492"
        transform="rotate(76.9243 96.491 35.1231)"
        fill="#FC413D"
      />
      <ellipse
        cx="9.02988"
        cy="41.6647"
        rx="30.832"
        ry="39.9417"
        transform="rotate(74.1257 9.02988 41.6647)"
        fill="#00B95C"
      />
    </g>
  </svg>
);

export default AntigravityLogo;
