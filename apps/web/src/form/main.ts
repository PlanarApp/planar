import './form.css';
import { mountForm } from './form';

const slug = location.pathname.split('/')[2] ?? '';
void mountForm(document.getElementById('form')!, slug);
