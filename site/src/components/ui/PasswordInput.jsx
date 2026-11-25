import { useState } from 'react'

export default function PasswordInput({ id, label, ...inputProps }) {
  const [visible, setVisible] = useState(false)

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          {...inputProps}
          id={id}
          type={visible ? 'text' : 'password'}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={`${visible ? 'Hide' : 'Show'} password`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </>
  )
}
