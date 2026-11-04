import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password input with a show/hide toggle (ASVS 2.1.12). The input keeps its
 * own className/style; the toggle sits inside its right edge (left in RTL).
 * Paste and password managers work as with a plain password input.
 */
export function PasswordField({ showLabel, hideLabel, className, style, ...rest }: InputProps & { showLabel: string; hideLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative w-full min-w-0">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        // A revealed password must not be spell-checked or auto-corrected
        // (spellcheckers may send words to a service).
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={className}
        style={{ ...style, paddingInlineEnd: "2.25rem" }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        title={shown ? hideLabel : showLabel}
        disabled={rest.disabled}
        className="absolute inset-y-0 end-0 flex items-center px-2.5 opacity-70 hover:opacity-100 disabled:opacity-30"
        style={{ color: "var(--text-dim)" }}
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
