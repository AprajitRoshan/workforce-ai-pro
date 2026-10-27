import { useRef, useState } from 'react'
import { Download, FileText, FileUp, Trash2, UploadCloud } from 'lucide-react'
import api, { download } from '../api/client'
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, cx, fmtDateTime, titleCase,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi, useDebounced } from '../hooks/useApi'

const TYPES = ['ID_PROOF', 'CONTRACT', 'CERTIFICATE', 'PAYSLIP', 'RESUME', 'OTHER']
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.txt,.xlsx,.csv'

export default function Documents() {
  const { isHR, user } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({ q: '', doc_type: '', employee_id: '' })
  const [page, setPage] = useState(1)
  const [upload, setUpload] = useState(null)
  const [del, setDel] = useState(null)
  const q = useDebounced(f.q)
  const { data: people } = useApi(isHR ? '/employees/options' : null)
  const { data, loading, reload } = useApi('/documents', { ...f, q, page, size: 15 })

  const remove = async () => {
    try { await api.delete(`/documents/${del.id}`); toast.success('Document deleted'); setDel(null); reload() } catch (e) { toast.error('Delete failed', e.message) }
  }
  return (
    <>
      <PageHeader title="Documents" icon={FileText} subtitle="Secure employee document storage with validation"
        actions={<Button icon={FileUp} onClick={() => setUpload({ file: null, doc_type: 'OTHER', title: '', employee_id: isHR ? '' : user.employee_id })}>Upload</Button>} />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="w-60" placeholder="Search title or filename…" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1) }} />
          <Select className="w-auto" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })} placeholder="All types" options={TYPES} />
          {isHR && <Select className="w-64" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} placeholder="All employees" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} />}
        </div>
        <DataTable loading={loading} rows={data?.items} page={data} onPage={setPage}
          empty={<EmptyState icon={FileText} title="No documents" description="Upload contracts, ID proofs or certificates." />} columns={[
            { key: 'title', label: 'Document', render: (d) => <div className="flex items-center gap-3"><div className="rounded-lg bg-brand-soft p-2 text-brand"><FileText className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate font-medium">{d.title}</p><p className="truncate text-xs text-muted">{d.original_name}</p></div></div> },
            isHR && { key: 'employee', label: 'Employee' }, { key: 'doc_type', label: 'Type', render: (d) => <Badge tone="indigo">{titleCase(d.doc_type)}</Badge> },
            { key: 'size', label: 'Size', align: 'right', render: (d) => (d.size > 1048576 ? `${(d.size / 1048576).toFixed(1)} MB` : `${(d.size / 1024).toFixed(1)} KB`) },
            { key: 'created_at', label: 'Uploaded', render: (d) => fmtDateTime(d.created_at) },
            { key: 'act', label: '', render: (d) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={Download} onClick={() => download(`/documents/${d.id}/download`, null, d.original_name).catch((e) => toast.error('Download failed', e.message))} />
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(d)} />
              </div>) },
          ].filter(Boolean)} />
      </Card>
      <UploadModal state={upload} setState={setUpload} people={people} isHR={isHR} onDone={reload} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Delete document?" message={`“${del?.title}” will be permanently removed from storage.`} confirmLabel="Delete" onConfirm={remove} />
    </>
  )
}

function UploadModal({ state, setState, people, isHR, onDone }) {
  const toast = useToast()
  const input = useRef(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!state) return null
  const pick = (file) => {
    setError('')
    if (!file) return
    const ext = `.${file.name.split('.').pop().toLowerCase()}`
    if (!ACCEPT.split(',').includes(ext)) return setError(`File type ${ext} is not allowed`)
    if (file.size > 10 * 1048576) return setError('File exceeds the 10 MB limit')
    setState({ ...state, file, title: state.title || file.name.replace(/\.[^.]+$/, '') })
  }
  const submit = async () => {
    const fd = new FormData()
    fd.append('file', state.file)
    fd.append('doc_type', state.doc_type)
    fd.append('title', state.title)
    if (state.employee_id) fd.append('employee_id', state.employee_id)
    setBusy(true)
    try { await api.post('/documents', fd); toast.success('Uploaded', state.title); setState(null); onDone() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={() => setState(null)} title="Upload document"
      footer={<><Button variant="secondary" onClick={() => setState(null)}>Cancel</Button><Button loading={busy} disabled={!state.file || (isHR && !state.employee_id)} onClick={submit}>Upload</Button></>}>
      <div className="space-y-3">
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()}
          className={cx('flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed p-8 text-center transition-colors', drag ? 'border-indigo-500 bg-brand-soft' : 'border-line hover:border-indigo-400')}>
          <UploadCloud className="h-8 w-8 text-indigo-500" />
          <p className="mt-2 text-sm font-medium">{state.file ? state.file.name : 'Drop a file or click to browse'}</p>
          <p className="text-xs text-muted">PDF, images, Word, Excel, CSV or text · max 10 MB</p>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files[0])} />
        </div>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {isHR && <Field label="Employee" className="sm:col-span-2"><Select value={state.employee_id} onChange={(e) => setState({ ...state, employee_id: e.target.value })} placeholder="Select employee…" options={(people || []).map((p) => ({ value: p.id, label: p.label }))} /></Field>}
          <Field label="Title"><Input value={state.title} onChange={(e) => setState({ ...state, title: e.target.value })} /></Field>
          <Field label="Type"><Select value={state.doc_type} onChange={(e) => setState({ ...state, doc_type: e.target.value })} options={TYPES} /></Field>
        </div>
        <p className="text-[11px] text-muted">Files are checked for allowed extension, size, matching file signature and duplicates.</p>
      </div>
    </Modal>
  )
}
