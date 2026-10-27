import { useRef, useState } from 'react'
import { BrainCircuit, CheckCircle2, Database, Download, FileWarning, Play, UploadCloud, Zap } from 'lucide-react'
import api, { download } from '../../api/client'
import { BarsChart } from '../../components/charts'
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, cx, fmtDateTime, fmtNum, titleCase,
} from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { invalidate, useApi } from '../../hooks/useApi'

export default function Datasets() {
  const toast = useToast()
  const { data: datasets, loading, reload } = useApi('/ai/datasets')
  const { data: models, reload: reloadModels } = useApi('/ai/models')
  const [upload, setUpload] = useState(null)
  const [failedFor, setFailedFor] = useState(null)
  const [training, setTraining] = useState(null)
  const active = models?.find((m) => m.is_active)

  const train = async (ds) => {
    setTraining(ds.id)
    try {
      const r = await api.post(`/ai/datasets/${ds.id}/train`)
      const m = r.data.model
      toast.success(`Model v${m.version} trained (${m.algorithm})`, `ROC-AUC ${m.metrics.roc_auc} · ${r.data.rescored.scored} employees re-scored`)
      invalidate('/ai'); invalidate('/employees'); invalidate('/dashboard')
      reload(); reloadModels()
    } catch (e) { toast.error('Training failed', e.message) } finally { setTraining(null) }
  }
  const activate = async (m) => {
    try { await api.post(`/ai/models/${m.id}/activate`); toast.success(`Model v${m.version} activated`); reloadModels() } catch (e) { toast.error('Activation failed', e.message) }
  }
  const imp = active ? Object.entries(active.feature_importance).slice(0, 10).map(([k, v]) => ({ feature: titleCase(k), importance: Math.round(v * 1000) / 10 })) : []

  return (
    <>
      <PageHeader title="Datasets & Models" icon={Database} subtitle="Upload historical HR data, validate it, and train the attrition model"
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => download('/ai/datasets/template', null, 'attrition_dataset_template.csv')}>CSV template</Button>
          <Button icon={UploadCloud} onClick={() => setUpload({ name: datasets?.[0]?.name || 'HR Attrition History', file: null })}>Upload dataset</Button>
        </>} />
      {active && (
        <div className="card mb-4 overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white">
            <div className="rounded-xl bg-white/15 p-3"><BrainCircuit className="h-6 w-6" /></div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wider text-indigo-100">Active model</p>
              <p className="text-lg font-bold">v{active.version} · {active.algorithm}</p>
              <p className="text-xs text-indigo-100">Trained {fmtDateTime(active.trained_at)} on {fmtNum(active.metrics.train_rows + active.metrics.test_rows)} records</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-5">
              {['roc_auc', 'accuracy', 'precision', 'recall', 'f1'].map((k) => (
                <div key={k} className="rounded-lg bg-white/10 px-3 py-2"><p className="text-lg font-bold">{(active.metrics[k] * 100).toFixed(1)}</p><p className="text-[10px] uppercase text-indigo-100">{k.replace('_', '-')}</p></div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold">Feature importance <span className="font-normal text-muted">(permutation, % of total)</span></p>
              <BarsChart data={imp} x="feature" layout="vertical" height={300} bars={[{ key: 'importance', name: 'Importance %', color: '#8b5cf6' }]} />
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Algorithm comparison <span className="font-normal text-muted">(ROC-AUC on hold-out set)</span></p>
              <div className="space-y-2">
                {Object.entries(active.metrics.candidates_auc || {}).sort((a, b) => b[1] - a[1]).map(([name, auc]) => (
                  <div key={name} className={cx('flex items-center justify-between rounded-lg border p-3', name === active.algorithm ? 'border-indigo-500 bg-brand-soft' : 'border-line')}>
                    <span className="text-sm font-medium">{name} {name === active.algorithm && <Badge tone="indigo">selected</Badge>}</span>
                    <span className="font-mono text-sm">{auc.toFixed(4)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">The engine trains several candidates and keeps the best by ROC-AUC. Demographic attributes (age, gender, marital status) are excluded from features by design.</p>
            </div>
          </div>
        </div>
      )}

      <Card title="Dataset versions" bodyClass="p-0">
        <DataTable loading={loading} rows={datasets} empty={<EmptyState icon={Database} title="No datasets yet" description="Upload a CSV with historical attrition outcomes to train the model." />} columns={[
          { key: 'name', label: 'Dataset', render: (d) => <div><p className="font-medium">{d.name} <Badge tone="indigo">v{d.version}</Badge></p><p className="text-xs text-muted">{d.notes}</p></div> },
          { key: 'total_records', label: 'Rows', align: 'right', render: (d) => fmtNum(d.total_records) },
          { key: 'valid_records', label: 'Valid', align: 'right', render: (d) => <span className="text-emerald-600">{fmtNum(d.valid_records)}</span> },
          { key: 'duplicate_records', label: 'Duplicates', align: 'right', render: (d) => <span className={d.duplicate_records ? 'text-amber-600' : ''}>{d.duplicate_records}</span> },
          { key: 'failed_records', label: 'Failed', align: 'right', render: (d) => <span className={d.failed_records ? 'text-rose-500' : ''}>{d.failed_records}</span> },
          { key: 'attrition_rate', label: 'Attrition', align: 'right', render: (d) => `${d.attrition_rate}%` },
          { key: 'status', label: 'Status', render: (d) => <div className="flex items-center gap-1"><StatusBadge status={d.status} />{d.model_version && <Badge tone="purple">model v{d.model_version}</Badge>}</div> },
          { key: 'created_at', label: 'Uploaded', render: (d) => fmtDateTime(d.created_at) },
          { key: 'act', label: '', render: (d) => (
            <div className="flex justify-end gap-1">
              {(d.failed_records + d.duplicate_records > 0) && <Button size="sm" variant="ghost" icon={FileWarning} onClick={() => setFailedFor(d)}>Issues</Button>}
              {d.status !== 'REJECTED' && <Button size="sm" variant="secondary" icon={Play} loading={training === d.id} onClick={() => train(d)}>Train</Button>}
            </div>) }]} />
      </Card>

      {models?.length > 0 && (
        <Card title="Model registry" className="mt-4" bodyClass="p-0">
          <DataTable rows={models} columns={[
            { key: 'version', label: 'Version', render: (m) => <b>v{m.version}</b> }, { key: 'algorithm', label: 'Algorithm' },
            { key: 'auc', label: 'ROC-AUC', align: 'right', render: (m) => m.metrics.roc_auc }, { key: 'f1', label: 'F1', align: 'right', render: (m) => m.metrics.f1 },
            { key: 'trained_at', label: 'Trained', render: (m) => fmtDateTime(m.trained_at) },
            { key: 'act', label: '', render: (m) => (m.is_active ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Active</Badge> : <Button size="sm" variant="ghost" icon={Zap} onClick={() => activate(m)}>Activate</Button>) }]} />
        </Card>
      )}

      <UploadDataset state={upload} setState={setUpload} onDone={() => { reload() }} />
      <FailedRecords dataset={failedFor} onClose={() => setFailedFor(null)} />
    </>
  )
}

function UploadDataset({ state, setState, onDone }) {
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  if (!state) return null
  const close = () => { setState(null); setResult(null) }
  const submit = async () => {
    const fd = new FormData()
    fd.append('file', state.file)
    fd.append('name', state.name)
    setBusy(true)
    try { const r = await api.post('/ai/datasets/upload', fd); setResult(r.data); onDone() }
    catch (e) { toast.error('Upload rejected', e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={close} title="Upload training dataset" subtitle="Same name = new version"
      footer={result ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={busy} disabled={!state.file || !state.name} onClick={submit}>Upload & validate</Button></>}>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{result.name} v{result.version} validated</span></div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[['Total', result.total_records], ['Valid', result.valid_records], ['Duplicates', result.duplicate_records], ['Failed', result.failed_records]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3"><p className="text-xl font-bold">{v}</p><p className="text-[11px] text-muted">{k}</p></div>
            ))}
          </div>
          <p className="text-sm text-muted">Attrition rate in data: <b>{result.attrition_rate}%</b>. Click <b>Train</b> on the dataset row to build a new model version.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Dataset name"><Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} /></Field>
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-line p-6 hover:border-indigo-400">
            <UploadCloud className="h-7 w-7 text-indigo-500" />
            <span className="mt-2 text-sm font-medium">{state.file ? state.file.name : 'Choose a CSV file'}</span>
            <span className="text-xs text-muted">Required columns match the template · max 20 MB</span>
          </button>
          <input ref={input} type="file" accept=".csv" className="hidden" onChange={(e) => setState({ ...state, file: e.target.files[0] })} />
        </div>
      )}
    </Modal>
  )
}

function FailedRecords({ dataset, onClose }) {
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading } = useApi(dataset ? `/ai/datasets/${dataset.id}/failed` : null, { kind, page, size: 10 })
  if (!dataset) return null
  return (
    <Modal open onClose={onClose} size="lg" title={`Validation issues · ${dataset.name} v${dataset.version}`}
      footer={<Button variant="secondary" icon={Download} onClick={() => download(`/ai/datasets/${dataset.id}/failed.csv`)}>Download report</Button>}>
      <Select className="mb-3 w-auto" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }} placeholder="All issues" options={['INVALID', 'DUPLICATE']} />
      <div className="rounded-lg border border-line">
        <DataTable loading={loading} rows={data?.items} rowKey="row_number" page={data} onPage={setPage} dense columns={[
          { key: 'row_number', label: 'Row' }, { key: 'kind', label: 'Kind', render: (r) => <Badge tone={r.kind === 'DUPLICATE' ? 'amber' : 'red'}>{r.kind}</Badge> },
          { key: 'reason', label: 'Reason', render: (r) => <span className="text-xs">{r.reason}</span> }]} />
      </div>
    </Modal>
  )
}
