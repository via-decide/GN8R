import { generateBatch, exportPosts } from '../src/templates.js';

const input = {
  theme: 'systems', intent: 'positioning', tone: 'builder',
  points: ['clarity beats speed', 'feedback loops build trust', 'ship small before scaling'], style: 'short'
};

const batch = generateBatch(input);
console.log('SHORT\n' + batch.short.join('\n\n'));
console.log('\nMID\n' + batch.mid.join('\n\n'));
console.log('\nSTORY\n' + batch.story.join('\n\n'));

if (process.argv.includes('--json')) {
  console.log('\nJSON\n' + JSON.stringify(batch, null, 2));
}
if (process.argv.includes('--md')) {
  console.log('\nMARKDOWN\n' + exportPosts(batch, 'markdown'));
}
