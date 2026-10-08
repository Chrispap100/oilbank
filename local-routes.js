module.exports = function(app, { auth, admin, pool, local, audit, parseData, vehicleAccess, rotateSession }) {
  app.post('/api/documents', auth, async (req, res) => {
    const p = parseData(req.body.dataUrl);
    if (!p || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(p.mime)) return res.status(400).json({ error: 'invalid_file' });
    if (p.buffer.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'file_too_large' });
    const vehicle = req.body.vehicleId ? await vehicleAccess(req.body.vehicleId, req.user) : null;
    if (req.body.vehicleId && !vehicle) return res.status(403).json({ error: 'forbidden' });
    const name = String(req.body.filename || 'document').slice(0, 255);
    const file = local.saveDocument(p.buffer);
    const extraction = { docType: 'other', vehicleId: vehicle ? String(vehicle.id) : null };
    const dup = await pool.query('SELECT id,filename,confirmed FROM documents WHERE sha256=$1 AND user_id=$2 LIMIT 1', [file.slice(0,64), vehicle?.user_id || req.user.id]);
    const q = await pool.query("INSERT INTO documents(user_id,vehicle_id,uploaded_by,filename,mime_type,file_path,size_bytes,sha256,doc_type,ai_status,ai_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'other','uploaded',$9) RETURNING id", [vehicle?.user_id || req.user.id, vehicle?.id || null, req.user.id, name, p.mime, file, p.buffer.length, file.slice(0,64), JSON.stringify(extraction)]);
    await audit(req.user.id, 'document_uploaded', 'document', q.rows[0].id, { filename: name });
    res.status(201).json({ documentId: String(q.rows[0].id), extraction, duplicate: dup.rows[0] || null });
  });
  app.get('/api/backup', auth, admin, async (req, res) => {
    await audit(req.user.id, 'backup_created', 'system', null, {});
    res.json(local.backup().result);
  });
  app.post('/api/backup/restore', auth, admin, async (req, res) => {
    try {
      const safety = local.restore(req.body);rotateSession();
      await audit(null, 'backup_restored', 'system', null, { safetyBackup: require('path').basename(safety) });
      res.json({ ok: true, loginRequired: true });
    } catch (e) { res.status(400).json({ error: 'restore_failed', message: e.message }); }
  });
  app.get('/api/export/csv', auth, admin, async (req, res) => {
    await audit(req.user.id, 'csv_exported', 'system', null, {});
    const result = local.exportCsv();res.json({ files: result.files });
  });
};
