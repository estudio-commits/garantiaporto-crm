# Importación histórica privada

El generador no se conecta a Supabase. Recibe un JSON revisado y produce SQL para ejecutar como administrador en SQL Editor. Los correos, planillas, JSON y SQL con clientes reales deben permanecer fuera del repositorio; nunca usar datos reales en pruebas.

Requiere migraciones 001–008 y un usuario Auth con perfil activo para el correo del responsable. El SQL generado incluye 009 en la misma transacción. No volver a ejecutar 001–008 sobre una instalación existente.

```sh
python3 scripts/build-historical-import.py /ruta/privada/revisado.json /ruta/privada/importacion.sql
npm run test:import
```

La prueba usa únicamente identidades ficticias en PostgreSQL 17 desechable (requiere Docker). Comprueba asignación, auditoría, evidencia original, permisos, repetición, colisiones, usuario inexistente y reversión completa ante errores.

Antes de cargar, revisar el lote y disponer de una copia de seguridad de la base. Abrir el archivo SQL privado, copiar todo su contenido en una consulta nueva de Supabase SQL Editor y ejecutar. Si ocurre un error, la transacción revierte todas las inserciones y la migración. Corregir la causa antes de reintentar.

El control previo detecta coincidencias de cédula, teléfono normalizado o nombre completo con fichas existentes, incluidas archivadas. Ante coincidencias ambiguas detiene el lote para conciliación. Repetir el mismo lote omite fichas importadas sin sobrescribir modificaciones posteriores. Cambiar un lote ya importado exige revisión, no una ejecución forzada.

La fecha de ingreso al CRM es la de importación; la fecha de solicitud proviene del formulario original. Los correos conservan su fecha original, los datos de marketing y el contenido recibido con acceso restringido. El historial distingue antecedentes históricos de contactos nuevos: importar notas antiguas no reinicia el seguimiento como si se hubiera contactado hoy.

## Evidencia histórica desconocida (009)

Una aprobación documentada puede tener fecha original desconocida mediante `decision_date_unknown`; sigue requiriendo referencia a su respaldo. Una emisión confirmada puede carecer de número de póliza mediante `issued_reference_unknown`, pero requiere fecha de emisión y garantía aprobada. La interfaz muestra estos faltantes explícitamente. Completar la evidencia elimina la marca de desconocido. Vendedores no pueden modificar estas excepciones; los formularios habituales siguen exigiendo evidencia completa.

No se consulta Clearing ni se emiten pólizas mediante esta carga. Los resultados históricos llevan su procedencia y no representan verificaciones nuevas. No se envían mensajes ni se activa WhatsApp.

## Fecha de ingreso original (010)

Después de importar, ejecutar `010_historical_entry_dates.sql` para que la fecha de ingreso refleje el primer formulario original. La corrección solo alcanza fichas con marcador de importación y correos históricos; conserva la fecha anterior en el historial, no altera la última actividad y es repetible. No modifica las altas manuales ni sus fechas. La fecha de solicitud conserva su valor original.
