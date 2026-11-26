// Bricht "npm run dist" ab, wenn nicht unter Windows gebaut wird.
// Grund: Mitgeliefert wird die koffi-Binary der Plattform, auf der gebaut wird (für die Tastendrücke).
// Ein unter Linux/macOS gebauter Windows-Installer hätte die falsche und die Controls würden nicht funktionieren.
if (process.platform !== 'win32') {
  console.error('Der Windows-Installer muss unter Windows gebaut werden (npm run dist auf einem Windows-PC).');
  process.exit(1);
}
