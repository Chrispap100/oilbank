
document.getElementById('fuelForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const entry = {
        vehicle: document.getElementById('vehicle').value,
        fuelType: document.getElementById('fuelType').value,
        station: document.getElementById('station').value,
        amount: parseFloat(document.getElementById('amount').value),
        price: parseFloat(document.getElementById('price').value),
        date: document.getElementById('date').value
    };
    entry.litres = (entry.amount / entry.price).toFixed(2);
    entry.vat = (entry.amount * 0.24).toFixed(2);
    entry.net = (entry.amount - entry.vat).toFixed(2);
    let logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    logs.push(entry);
    localStorage.setItem('fuelLogs', JSON.stringify(logs));
    displayLogs();
    this.reset();
});

function displayLogs() {
    const tbody = document.querySelector('#logTable tbody');
    tbody.innerHTML = '';
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    const filter = document.getElementById('vehicleFilter').value.toLowerCase();
    logs.forEach((log, index) => {
        if (!log.vehicle.toLowerCase().includes(filter)) return;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${log.date}</td>
            <td>${log.vehicle}</td>
            <td>${log.fuelType}</td>
            <td>${log.station}</td>
            <td>€${log.amount}</td>
            <td>€${log.price}</td>
            <td>${log.litres} L</td>
            <td>€${log.vat}</td>
            <td>€${log.net}</td>
            <td><button onclick="deleteEntry(${index})">Διαγραφή</button></td>
        `;
        tbody.appendChild(row);
    });
}

function deleteEntry(index) {
    let logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    logs.splice(index, 1);
    localStorage.setItem('fuelLogs', JSON.stringify(logs));
    displayLogs();
}

function exportToCSV() {
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    let csv = "Ημερομηνία,Όχημα,Καύσιμο,Πρατήριο,Ποσό,Τιμή/L,Λίτρα,ΦΠΑ,Καθαρό\n";
    logs.forEach(log => {
        csv += `${log.date},${log.vehicle},${log.fuelType},${log.station},${log.amount},${log.price},${log.litres},${log.vat},${log.net}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fuel_data.csv";
    a.click();
}

document.getElementById('vehicleFilter').addEventListener('input', displayLogs);
window.onload = displayLogs;
