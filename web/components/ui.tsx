"use client";

import { useId, useState, type ReactNode } from "react";
import { check, type FieldDef } from "@/lib/fields";
import type { Verdict } from "@/lib/types";
import { Alert, Check, Cross, Info, Question } from "./icons";

/** Numeric input with label, unit, hint and inline validation shown after the user leaves the field. */
export function NumberField({
  def,
  value,
  onChange,
  serverError,
  id: idProp,
}: {
  def: FieldDef;
  value: number | "";
  onChange: (v: number | "") => void;
  serverError?: string;
  id?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const [touched, setTouched] = useState(false);
  const scale = def.scale ?? 1;
  const shown = value === "" ? "" : Math.round(value * scale * 1e6) / 1e6;
  const local = touched ? check(def, shown) : "";
  const error = local || serverError || "";
  const describedBy = [def.hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{def.label}</label>
      <div className="input-wrap" data-invalid={error ? "true" : undefined}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={shown}
          min={def.gt ? undefined : def.min}
          max={def.max}
          step={def.step ?? (def.int ? 1 : "any")}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? "" : Number(raw) / scale);
          }}
          onBlur={() => setTouched(true)}
        />
        {def.unit && <span className="unit">{def.unit}</span>}
      </div>
      {error ? (
        <span className="error" id={`${id}-err`} role="alert">
          <Alert size={14} /> {error}
        </span>
      ) : (
        def.hint && (
          <span className="hint" id={`${id}-hint`}>
            {def.hint}
          </span>
        )
      )}
    </div>
  );
}

/** Renders every field of ``defs`` for ``value``; advanced fields go behind a disclosure. */
export function FieldGroup<T extends Record<string, number>>({
  defs,
  value,
  onChange,
  errors = {},
  prefix,
  legend,
  description,
}: {
  defs: Record<string, FieldDef>;
  value: T;
  onChange: (v: T) => void;
  errors?: Record<string, string>;
  prefix: string;
  legend?: string;
  description?: ReactNode;
}) {
  const keys = Object.keys(defs);
  const main = keys.filter((k) => !defs[k].advanced);
  const adv = keys.filter((k) => defs[k].advanced);
  const field = (k: string) => (
    <NumberField
      key={k}
      id={`${prefix}-${k}`}
      def={defs[k]}
      value={value[k] as number}
      serverError={errors[`${prefix}.${k}`]}
      onChange={(v) => onChange({ ...value, [k]: v } as T)}
    />
  );
  const advError = adv.some((k) => errors[`${prefix}.${k}`]);
  return (
    <fieldset className="stack">
      {legend && <legend>{legend}</legend>}
      {description && <p className="muted small" style={{ marginTop: -6 }}>{description}</p>}
      <div className="grid-2">{main.map(field)}</div>
      {adv.length > 0 && (
        <details className="more" open={advError || undefined}>
          <summary>More settings</summary>
          <div className="grid-2">{adv.map(field)}</div>
        </details>
      )}
    </fieldset>
  );
}

const VERDICT: Record<string, { tone: string; label: string; icon: ReactNode; plain: string }> = {
  PASS: { tone: "good", label: "Pass", icon: <Check />, plain: "The setup meets the SLA with headroom." },
  PASS_WITH_CONDITIONS: {
    tone: "warn",
    label: "Pass with conditions",
    icon: <Alert />,
    plain: "It meets the SLA, but only if the conditions below are addressed.",
  },
  FAIL: { tone: "bad", label: "Fail", icon: <Cross />, plain: "The SLA breaks under this load." },
  NOT_ASSESSABLE: {
    tone: "na",
    label: "Not assessable",
    icon: <Question />,
    plain: "The model could not reproduce your measurement closely enough to be trusted.",
  },
  NOT_ASSESSED: { tone: "na", label: "Not judged", icon: <Info />, plain: "" },
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const v = VERDICT[verdict] ?? VERDICT.NOT_ASSESSED;
  return (
    <span className={`badge tone-${v.tone}`}>
      {v.icon && <span style={{ display: "inline-flex", transform: "scale(.8)" }}>{v.icon}</span>}
      {v.label}
    </span>
  );
}

export function VerdictBanner({
  verdict,
  title,
  plain,
  children,
}: {
  verdict: Verdict;
  title?: string;
  plain?: string;
  children?: ReactNode;
}) {
  const v = VERDICT[verdict];
  return (
    <section className={`verdict tone-${v.tone}`} aria-label="Verdict">
      <span className="icon">{v.icon}</span>
      <h2>{title ?? v.label}</h2>
      <div className="stack-sm">
        <p>{plain ?? v.plain}</p>
        {children}
      </div>
    </section>
  );
}

export function Notice({ tone = "na", children, title }: { tone?: "na" | "warn" | "bad" | "good"; children: ReactNode; title?: string }) {
  return (
    <div className={`notice tone-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      {tone === "bad" ? <Cross size={16} /> : tone === "warn" ? <Alert size={16} /> : <Info size={16} />}
      <div className="stack-sm" style={{ gap: 2 }}>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {s && <span className="s">{s}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
