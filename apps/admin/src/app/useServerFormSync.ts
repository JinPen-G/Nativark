import { Form, type FormInstance } from "antd";
import { useEffect, useRef, useState } from "react";
import { formSnapshotFingerprint, ServerFormSnapshot, subscribeFormSave } from "./serverFormSnapshot";

/** Adopt fresh settings only while the local draft is unchanged. Keep its
 * original expectedRevision on conflict; polling is never approval to overwrite. */
export function useServerFormSync<Values>(form: FormInstance<Values>, source: unknown, apply: () => void, resetKey?: string) {
  const values = Form.useWatch([], { form, preserve: true });
  const state = useRef(new ServerFormSnapshot());
  const key = useRef(resetKey);
  if (key.current !== resetKey) { key.current = resetKey; state.current = new ServerFormSnapshot(); }
  const latestApply = useRef(apply);
  latestApply.current = apply;
  const [saved, setSaved] = useState(0);
  useEffect(() => subscribeFormSave(form, fingerprint => {
    state.current.savedValues(fingerprint);
    setSaved(value => value + 1);
  }), [form]);
  useEffect(() => {
    state.current.sync(source, formSnapshotFingerprint(form.getFieldsValue(true)), () => {
      latestApply.current();
      return formSnapshotFingerprint(form.getFieldsValue(true));
    });
  }, [form, source, values, saved, resetKey]);
  return () => state.current.isCurrent(source);
}
