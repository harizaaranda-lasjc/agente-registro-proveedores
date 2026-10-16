---
name: registro-proveedor
description: Reglas de negocio y conocimiento operativo para la validación y mapeo de registro de proveedores por país.
---

# Conocimiento del Proceso — Registro de Proveedores

## Reglas por País (Identificación Tributaria)
- **Colombia (CO):** NIT (9 dígitos + dígito de verificación).
- **Ecuador (EC):** RUC (13 dígitos). Si se usa NIT de Colombia, marcar como `requiere_confirmacion`.
- **Honduras (HN):** RTN (14 dígitos). Si se usa NIT de Colombia, marcar como `requiere_confirmacion`.
- **Panamá (PA):** RUC / DV. Formato en portal web.

## Validación de Soportes
- La vigencia de los soportes se valida contra la fecha actual.
- Soportes vencidos o faltantes bloquean el estado `listo_para_firma`.