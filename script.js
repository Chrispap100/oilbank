
document.getElementById('fuelForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const vehicle = document.getElementById('vehicle').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const price = parseFloat(document.getElementById('price').value);
    const date = document.getElementById('date').value;
    const litres = (amount / price).toFixed(2);
    const vat = (amount * 0.24).toFixed(2);
    const net = (amount - vat).toFixed(2);
    const entry = {
        vehicle, amount, price, date, litres, vat, net
    };
    let logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    logs.push(entry);
    localStorage.setItem('fuelLogs', JSON.stringify(logs));
    displayLogs();
    this.reset();
});

function displayLogs() {
    const list = document.getElementById('logList');
    list.innerHTML = '';
    const logs = JSON.parse(localStorage.getItem('fuelLogs')) || [];
    logs.forEach(log => {
        const item = document.createElement('li');
        item.textContent = `${log.date} - ${log.vehicle} - €${log.amount} | ${log.litres}L @ €${log.price}/L | ΦΠΑ: €${log.vat} | Καθαρό: €${log.net}`;
        list.appendChild(item);
    });
}

window.onload = displayLogs;
