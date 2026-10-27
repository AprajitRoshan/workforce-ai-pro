import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from ..config import UPLOAD_DIR, settings
from ..database import get_db
from ..models import Document, Employee, User
from ..security import HR_ROLES, ensure_can_view_employee, get_current_user, visible_employee_ids
from ..services.events import log_activity, notify
from ..utils import client_ip, document_dict, paginate

router = APIRouter(prefix="/api/documents", tags=["Documents"])

DOC_TYPES = {"ID_PROOF", "CONTRACT", "CERTIFICATE", "PAYSLIP", "RESUME", "OTHER"}
MAGIC = {".pdf": [b"%PDF"], ".png": [b"\x89PNG"], ".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"],
         ".docx": [b"PK\x03\x04"], ".xlsx": [b"PK\x03\x04"], ".doc": [b"\xd0\xcf\x11\xe0"]}


def validate_upload(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in settings.ALLOWED_DOC_EXTENSIONS:
        raise HTTPException(400, f"File type {ext or '(none)'} is not allowed. Allowed: "
                                 f"{', '.join(sorted(settings.ALLOWED_DOC_EXTENSIONS))}")
    if not content:
        raise HTTPException(400, "File is empty")
    if len(content) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")
    sigs = MAGIC.get(ext)
    if sigs and not any(content.startswith(s) for s in sigs):
        raise HTTPException(400, f"File content does not match its {ext} extension")
    return ext


@router.post("", status_code=201)
async def upload(request: Request, file: UploadFile = File(...), employee_id: int | None = Form(None),
                 doc_type: str = Form("OTHER"), title: str | None = Form(None),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    eid = employee_id or user.employee_id
    if not eid:
        raise HTTPException(400, "Select an employee")
    if user.role not in HR_ROLES and eid != user.employee_id:
        raise HTTPException(403, "You can only upload your own documents")
    emp = db.get(Employee, eid)
    if not emp:
        raise HTTPException(404, "Employee not found")
    doc_type = doc_type.upper()
    if doc_type not in DOC_TYPES:
        raise HTTPException(400, f"doc_type must be one of {', '.join(sorted(DOC_TYPES))}")
    content = await file.read()
    ext = validate_upload(file.filename or "", content)
    checksum = hashlib.sha256(content).hexdigest()
    if db.query(Document).filter_by(employee_id=eid, checksum=checksum).first():
        raise HTTPException(409, "This exact file has already been uploaded for this employee")
    stored = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / stored).write_bytes(content)
    doc = Document(employee_id=eid, uploaded_by=user.id, doc_type=doc_type, title=title or Path(file.filename).stem,
                   original_name=file.filename, stored_name=stored,
                   content_type=file.content_type or "application/octet-stream", size=len(content), checksum=checksum)
    db.add(doc)
    db.commit()
    log_activity(db, user, "UPLOAD", "document", doc.id, f"Uploaded {doc.doc_type} '{doc.title}' for {emp.full_name}",
                 ip=client_ip(request))
    owner = db.query(User).filter_by(employee_id=eid).first()
    if owner and owner.id != user.id:
        notify(db, [owner.id], "New document added", f"{user.full_name} uploaded '{doc.title}' to your profile.",
               category="SYSTEM", link="/documents")
    return document_dict(doc)


@router.get("")
def list_documents(employee_id: int | None = None, doc_type: str | None = None, q: str | None = None,
                   page: int = 1, size: int = 20, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Document).options(joinedload(Document.employee))
    ids = visible_employee_ids(db, user)
    if user.role == "MANAGER":  # managers do not see team members' personal documents
        ids = [user.employee_id] if user.employee_id else []
    if ids is not None:
        query = query.filter(Document.employee_id.in_(ids))
    if employee_id:
        query = query.filter(Document.employee_id == employee_id)
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if q:
        query = query.filter(Document.title.ilike(f"%{q}%") | Document.original_name.ilike(f"%{q}%"))
    return paginate(query.order_by(Document.created_at.desc()), page, size, document_dict)


def _get_allowed(db: Session, user: User, doc_id: int) -> Document:
    d = db.get(Document, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    if user.role not in HR_ROLES and d.employee_id != user.employee_id:
        raise HTTPException(403, "Not allowed")
    return d


@router.get("/{doc_id}/download")
def download(doc_id: int, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = _get_allowed(db, user, doc_id)
    path = UPLOAD_DIR / d.stored_name
    if not path.exists():
        raise HTTPException(410, "File is missing from storage")
    log_activity(db, user, "DOWNLOAD", "document", d.id, f"Downloaded '{d.title}'", ip=client_ip(request))
    return FileResponse(path, media_type=d.content_type, filename=d.original_name)


@router.delete("/{doc_id}")
def delete(doc_id: int, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = _get_allowed(db, user, doc_id)
    (UPLOAD_DIR / d.stored_name).unlink(missing_ok=True)
    title = d.title
    db.delete(d)
    db.commit()
    log_activity(db, user, "DELETE", "document", doc_id, f"Deleted document '{title}'", ip=client_ip(request))
    return {"ok": True}
