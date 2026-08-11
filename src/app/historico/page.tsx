'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type Settings = {
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  smtp_reply_to: string;
  repo_email_to_upe: string;
  repo_email_cc_upe: string;
  repo_email_subject_upe: string;
  repo_email_body_upe: string;
  repo_email_to_oncologia: string;
  repo_email_cc_oncologia: string;
  repo_email_subject_oncologia: string;
  repo_email_body_oncologia: string;
};

const DEFAULT_SETTINGS: Settings = {
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: 'false',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_reply_to: '',
  repo_email_to_upe: '',
  repo_email_cc_upe: '',
  repo_email_subject_upe: 'Pedido de reposicion UPE #{pedido_id} - {fecha}',
  repo_email_body_upe:
    'Adjuntamos albaran de reposicion para preparacion en Farmacia.\n\nPedido: #{pedido_id}\nFecha: {fecha}\nLineas: {lineas}\n\nGracias.',
  repo_email_to_oncologia: '',
  repo_email_cc_oncologia: '',
  repo_email_subject_oncologia: 'Pedido de reposicion Oncologia #{pedido_id} - {fecha}',
  repo_email_body_oncologia:
    'Adjuntamos albaran de reposicion de Oncologia para preparacion en Farmacia.\n\nPedido: #{pedido_id}\nFecha: {fecha}\nLineas: {lineas}\n\nGracias.',
};

export default function ConfigPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? 'No se pudo cargar configuración.');
        setSettings((prev) => ({
          ...prev,
          ...payload,
          repo_email_to_upe: payload.repo_email_to_upe || payload.repo_email_to || prev.repo_email_to_upe,
          repo_email_cc_upe: payload.repo_email_cc_upe || payload.repo_email_cc || prev.repo_email_cc_upe,
          repo_email_subject_upe:
            payload.repo_email_subject_upe || payload.repo_email_subject || prev.repo_email_subject_upe,
          repo_email_body_upe:
            payload.repo_email_body_upe || payload.repo_email_body || prev.repo_email_body_upe,
        }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Error inesperado');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const change = (key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'No se pudo guardar.');
      toast.success('Configuración de email guardada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Cargando configuración…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Config</h1>
        <p className="text-sm text-slate-500">
          Configuración editable para envío de albaranes PDF de reposición.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Servidor SMTP</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Host SMTP">
            <input
              value={settings.smtp_host}
              onChange={(e) => change('smtp_host', e.target.value)}
              placeholder="smtp.office365.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Puerto">
              <input
                value={settings.smtp_port}
                onChange={(e) => change('smtp_port', e.target.value)}
                placeholder="587"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="SSL/TLS">
              <select
                value={settings.smtp_secure}
                onChange={(e) => change('smtp_secure', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="false">No (STARTTLS)</option>
                <option value="true">Sí (SSL/TLS)</option>
              </select>
            </Field>
          </div>
          <Field label="Usuario SMTP">
            <input
              value={settings.smtp_user}
              onChange={(e) => change('smtp_user', e.target.value)}
              placeholder="usuario@dominio.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Contraseña SMTP">
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={settings.smtp_pass}
                onChange={(e) => change('smtp_pass', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-slate-500 hover:text-slate-700"
              >
                {showPass ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </Field>
          <Field label="Remitente (From)">
            <input
              value={settings.smtp_from}
              onChange={(e) => change('smtp_from', e.target.value)}
              placeholder="farmacia@hospital.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Reply-To (coma separada)">
            <input
              value={settings.smtp_reply_to}
              onChange={(e) => change('smtp_reply_to', e.target.value)}
              placeholder="farmacia@hospital.com, otro@hospital.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </section>

      <EmailAreaSection
        title="Email de reposición — UPE"
        prefix="upe"
        settings={settings}
        change={change}
      />
      <EmailAreaSection
        title="Email de reposición — Oncología"
        prefix="oncologia"
        settings={settings}
        change={change}
      />

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

function EmailAreaSection({
  title,
  prefix,
  settings,
  change,
}: {
  title: string;
  prefix: 'upe' | 'oncologia';
  settings: Settings;
  change: (key: keyof Settings, value: string) => void;
}) {
  const toKey = `repo_email_to_${prefix}` as keyof Settings;
  const ccKey = `repo_email_cc_${prefix}` as keyof Settings;
  const subjectKey = `repo_email_subject_${prefix}` as keyof Settings;
  const bodyKey = `repo_email_body_${prefix}` as keyof Settings;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Destinatarios (TO)">
          <input
            value={settings[toKey]}
            onChange={(e) => change(toKey, e.target.value)}
            placeholder="destino1@hospital.com, destino2@hospital.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Copia (CC)">
          <input
            value={settings[ccKey]}
            onChange={(e) => change(ccKey, e.target.value)}
            placeholder="cc1@hospital.com, cc2@hospital.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <Field label="Asunto">
        <input
          value={settings[subjectKey]}
          onChange={(e) => change(subjectKey, e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Cuerpo del email">
        <textarea
          value={settings[bodyKey]}
          onChange={(e) => change(bodyKey, e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Variables: <code>{'{pedido_id}'}</code>, <code>{'{fecha}'}</code>, <code>{'{lineas}'}</code>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
      {children}
    </div>
  );
}
