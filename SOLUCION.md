# Solución — Agente de Registro de Proveedores
**Autor:** Hubert Ariza Aranda  
**Proyecto:** Periferia IT Group S.A.S. — Equipo Perxia 2.0  

---

## 1. Problema en una frase
El área administrativa de Periferia transcribe manualmente entre 8 y 12 solicitudes de registro de proveedores al mes en formatos heterogéneos (Excel, PDF, Portales Web), generando reprocesos y demoras en la facturación.

---

## 2. Arquitectura de la Solución

```text
┌─────────────────┐        HTTP POST        ┌──────────────────────────────────────────────────┐
│   Front Chat    │ ──────────────────────> │                     Backend                      │
│ (public/index)  │ <────────────────────── │                  (src/server.ts)                 │
└─────────────────┘                         └────────────────────────┬─────────────────────────┘
                                                                     │
                                           ┌─────────────────────────┴─────────────────────────┐
                                           │               Ciclo del Agente (LLM)              │
                                           │     (Adapter Mock / OpenAI + System Prompt)       │
                                           └─────────────────────────┬─────────────────────────┘
                                                                     │
                                           ┌─────────────────────────┴─────────────────────────┐
                                           │              Herramientas Zod (Tools)             │
                                           │              (src/tools/proveedor.ts)             │
                                           └─────────────────────────┬─────────────────────────┘
                                                                     │
                                            ┌────────────────────────┴────────────────────────┐
                                            │                                                 │
                                   fixtures/ (Solo lectura)                            out/ (Escritura)