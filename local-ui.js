$('#smartManual').addEventListener('click', async () => {
  const file = $('#smartFile').files[0];
  if (!file) return toast('Διάλεξε φωτογραφία ή PDF.');
  if (file.size > 12 * 1024 * 1024) return toast('Μέγιστο 12 MB.');
  try {
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader();r.onload = () => resolve(r.result);r.onerror = reject;r.readAsDataURL(file); });
    pendingDocV4 = await api('/api/documents', { method: 'POST', body: JSON.stringify({ filename: file.name, dataUrl }) });
    showAiV4(pendingDocV4);await refreshAll();
    toast('Το αρχείο αποθηκεύτηκε τοπικά. Συμπλήρωσε τα στοιχεία.');
  } catch (e) { toast('Αποτυχία αποθήκευσης αρχείου.'); }
});
$('#csvExportBtn').addEventListener('click', async () => {
  try {
    await api('/api/export/csv');
    toast('Δημιουργήθηκαν 7 αρχεία CSV στον φάκελο exports του OilBank.');
  } catch (e) { toast('Η εξαγωγή απέτυχε.'); }
});
// Unconfirmed files can be completed after closing/reopening the app.
const originalRenderDocumentsLocal = renderDocumentsV4;
renderDocumentsV4 = function() {
  originalRenderDocumentsLocal();
  $('#documentList').querySelectorAll('[data-docopen]').forEach(button => {
    const doc = documentsV4.find(d => d.id === button.dataset.docopen);
    if (!doc || doc.confirmed) return;
    const edit = document.createElement('button');edit.className = 'icon-btn';edit.textContent = 'Καταχώριση';
    edit.onclick = () => { pendingDocV4 = { documentId: doc.id, extraction: doc.ai_json || {} };showAiV4(pendingDocV4); };
    button.after(edit);
  });
};
