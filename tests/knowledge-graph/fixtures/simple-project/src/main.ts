import { format } from './utils/format';
import Header from './components/Header.vue';

export function main(): void {
  const text = format('hello');
  console.log(text, Header);
}
