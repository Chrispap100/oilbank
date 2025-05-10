
document.getElementById('fuelForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const vehicle = document.getElementById('vehicle').value;
    const fuelType = document.getElementById('fuelType').value;
    const station = document.getElementById('station').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const price = parseFloat(document.getElementById('price').value);
    const date = document.getElementById('date').value;
    const litres = (amount / price).toFixed(2);
    const vat = (amount * 0.24).toFixed(2);
    const net = (amount - vat).toFixed(2);
    const entry = {
        vehicle, fuelType, station, amount, price, date, litres, vat, net
    };
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
    logs.forEach(log => {
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
        `;
        tbody.appendChild(row);
    });
}

window.onload = displayLogs;
