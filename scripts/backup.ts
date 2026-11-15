import { createBackup } from "../lib/backup";

const result = await createBackup();
console.log(`Copia creada: ${result.destination}`);

