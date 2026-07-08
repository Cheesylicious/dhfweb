import { apiFetch } from '../utils/api.js';

const tbody = document.getElementById('dogs-table-body');
const modal = document.getElementById('dog-modal');

async function loadDogs() {
    const dogs = await apiFetch('/api/dogs/');
    tbody.innerHTML = '';
    dogs.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${d.name}</td><td>${d.breed || '-'}</td><td>${d.chip_number || '-'}</td><td>${d.owner_name}</td>
                        <td><button onclick='editDog(${JSON.stringify(d)})'>Bearbeiten</button></td>`;
        tbody.appendChild(tr);
    });
}

window.editDog = (d) => {
    document.getElementById('dog-id').value = d.id;
    document.getElementById('dog-name').value = d.name;
    document.getElementById('dog-breed').value = d.breed || '';
    document.getElementById('dog-chip').value = d.chip_number || '';
    document.getElementById('dog-birth').value = d.birthdate || '';
    document.getElementById('dog-owner').value = d.owner_id || '';
    modal.style.display = 'block';
};

document.getElementById('save-dog-btn').onclick = async () => {
    const id = document.getElementById('dog-id').value;
    const payload = {
        name: document.getElementById('dog-name').value,
        breed: document.getElementById('dog-breed').value,
        chip_number: document.getElementById('dog-chip').value,
        birthdate: document.getElementById('dog-birth').value,
        owner_id: document.getElementById('dog-owner').value
    };
    
    if(id) {
        await apiFetch(`/api/dogs/${id}`, 'PUT', payload);
    } else {
        await apiFetch('/api/dogs/', 'POST', payload);
    }
    modal.style.display = 'none';
    loadDogs();
};

document.getElementById('add-dog-btn').onclick = () => {
    document.getElementById('dog-id').value = '';
    modal.style.display = 'block';
};

loadDogs();