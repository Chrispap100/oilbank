
let deletedLog = null;

document.getElementById('vehicleForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const plate = document.getElementById('plate').value;
    const model = document.getElementById('model').value;
    const fuel = document.getElementById('fuelKind').value;
    let vehicles = JSON.parse(localStorage.getItem('vehicles')) || [];
    vehicles.push({ plate, model, fuel });
    localStorage.setItem('vehicles', JSON.stringify(vehicles));
    displayVehicles();
    populateVehicleSelect();
    this.reset();
});

function displayVehicles() {
    const list = document.getElementById('vehicleList');
    list.innerHTML = '';
    const vehicles = JSON.parse(localStorage.getItem('vehicles')) || [];
    vehicles.forEach((v, i) => {
        const li = document.createElement('li');
        li.textContent = `${v.plate} - ${v.model} (${v.fuel}) `;
        const delBtn = document.createElement('button');
        delBtn.textContent = "Διαγραφή";
        delBtn.classList.add('delete');
        delBtn.onclick = () => {
            vehicles.splice(i, 1);
            localStorage.setItem('vehicles', JSON.stringify(vehicles));
            displayVehicles();
            populateVehicleSelect();
        };
        li.appendChild(delBtn);
        list.appendChild(li);
    });
}

function populateVehicleSelect() {
    const select = document.getElementById('vehicleSelect');
    select.innerHTML = '';
    const vehicles = JSON.parse(localStorage.getItem('vehicles')) || [];
    vehicles.forEach(v => {
        const option = document.createElement('option');
        option.value = v.plate;
        option.textContent = `${v.plate} - ${v.model}`;
        select.appendChild(option);
    });
}

document.getElementById('fuelForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const vehicle = document.getElementById('vehicleSelect').value;
    const vehicles = JSON.parse(localStorage.getItem('vehicles')) || [];
    const vInfo = vehicles.find(v => v.plate === vehicle);
    const entry = {
        vehicle,
        fuelType: vInfo ? vInfo.fuel : "Άγνωστο",
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
    displayTotals();
    displayRecentLogs();
    this.reset();
});

function displayLogs() {
    const tbody = document.querySelector('#logTable tbody');
    tbody.innerHTML = '';
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    logs.forEach((log, index) => {
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
            <td>
                <button onclick="deleteEntry(${index})">Διαγραφή</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function deleteEntry(index) {
    let logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    deletedLog = logs[index];
    logs.splice(index, 1);
    localStorage.setItem('fuelLogs', JSON.stringify(logs));
    displayLogs();
    displayTotals();
    displayRecentLogs();
    showUndo();
}

function showUndo() {
    const container = document.getElementById('undoContainer');
    container.innerHTML = '<button onclick="undoDelete()">Αναίρεση Διαγραφής</button>';
    setTimeout(() => { container.innerHTML = ''; }, 10000);
}

function undoDelete() {
    if (deletedLog) {
        let logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
        logs.push(deletedLog);
        localStorage.setItem('fuelLogs', JSON.stringify(logs));
        displayLogs();
        displayTotals();
        displayRecentLogs();
        deletedLog = null;
        document.getElementById('undoContainer').innerHTML = '';
    }
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

function displayTotals() {
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    let totalAmount = 0;
    let totalLitres = 0;
    logs.forEach(log => {
        totalAmount += parseFloat(log.amount);
        totalLitres += parseFloat(log.litres);
    });
    const avgPrice = (totalAmount / totalLitres).toFixed(2);
    document.getElementById('totals').innerHTML = `
        Συνολικά €: ${totalAmount.toFixed(2)}<br>
        Συνολικά Λίτρα: ${totalLitres.toFixed(2)}<br>
        Μέση Τιμή/L: €${isNaN(avgPrice) ? '0.00' : avgPrice}
    `;
}

function displayRecentLogs() {
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    const recent = logs.slice(-5).reverse();
    const ul = document.getElementById('recentLogs');
    ul.innerHTML = '';
    recent.forEach(log => {
        const li = document.createElement('li');
        li.textContent = `${log.date} - ${log.vehicle} - €${log.amount}`;
        ul.appendChild(li);
    });
}

window.onload = () => {
    displayVehicles();
    populateVehicleSelect();
    displayLogs();
    displayTotals();
    displayRecentLogs();
};
