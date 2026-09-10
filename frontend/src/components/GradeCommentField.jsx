import React, { useId } from "react";

export default function GradeCommentField({ value, onChange, disabled = false }) {
  const id = useId();
  return (
    <div className="mx-auto w-full min-w-0 max-w-md text-left">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold text-stone-600">
        <label htmlFor={id}>Zusatzinfo zur Note</label>
        <span className="shrink-0 font-mono">{value.length}/150</span>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={150}
        rows={2}
        disabled={disabled}
        className="block w-full resize-none rounded-lg border-2 border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-none focus:border-stone-900 disabled:opacity-50"
      />
    </div>
  );
}
