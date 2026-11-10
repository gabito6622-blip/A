# Investigación — índice y conclusiones vigentes

| Documento | Contenido |
|---|---|
| [`INVESTIGACION_COMPETIDORES.md`](INVESTIGACION_COMPETIDORES.md) | Informe principal: acceso, matriz, hallazgos y recomendación |
| [`docs/research/anexo-A-fuentes-publicas.md`](docs/research/anexo-A-fuentes-publicas.md) | 19 productos: precios y funciones anunciadas, con URL verificadas el 10-nov-2026 |
| [`docs/research/anexo-B-demo-dentalpin.md`](docs/research/anexo-B-demo-dentalpin.md) | Demo pública de DentalPin: pasos, resultados y notas por área |
| [`docs/research/anexo-C-demo-panel-dental.md`](docs/research/anexo-C-demo-panel-dental.md) | Demo pública de Panel Dental |
| [`docs/research/anexo-D-demo-odontoar-dentrisoft.md`](docs/research/anexo-D-demo-odontoar-dentrisoft.md) | Demo interactiva de Odonto.ar y portal del paciente de Dentrisoft |
| [`docs/research/anexo-E-marco-legal-bolivia.md`](docs/research/anexo-E-marco-legal-bolivia.md) | Mapa legal preliminar (datos, expediente clínico, consentimiento, SIAT, QR, mensajería) |
| `docs/research/capturas/` | 64 capturas de demos públicas con datos ficticios (uso interno) |

## Marco boliviano: lo que ya condiciona el diseño

> **No es asesoramiento legal ni una declaración de cumplimiento.** Es un mapa preliminar para revisar con un abogado boliviano. Los niveles de confianza de cada afirmación están en el anexo E.

| Tema | Hallazgo (marcador del anexo E) | Cómo lo refleja el sistema |
|---|---|---|
| Datos personales | No hay ley general vigente al 10-nov-2026; el PL 538/2025-2026 figuraba "en tratamiento". Rigen la CPE (arts. 21, 130 y 131) y la Ley 164 con el DS 1793 (art. 56: consentimiento expreso, finalidad y seguridad; su alcance está por confirmar) | Consentimientos separados por finalidad con fecha (hoy booleanos; tabla versionada en B-003); minimización en el asistente; auditoría de lecturas |
| Expediente clínico | Ley 3131 y DS 28562 (art. 14: la información dada al paciente se registra y firma); RM 0090/2008; el reglamento del SEDES La Paz exige que el software **no permita modificar** registros guardados y fija **10 años** de archivo activo | Notas y odontograma inmutables con enmiendas; sin borrado (solo archivo); retención configurable pendiente |
| Consentimiento informado | Por escrito, firmado por el paciente o su representante; los menores necesitan representante | Responsable obligatorio para menores (probado); consentimiento por procedimiento en B-004 |
| Facturación | RND 102100000011: modalidades electrónica y computarizada en línea, CUIS, CUFD y CUF, Proveedor autorizado (3 años, homologación). En 2026: RND 102600000034 (pruebas del anexo de la Ley 1733 hasta el 16-nov-2026) y RND 102600000042 (homologación del catálogo hasta el 31-dic-2026). IVA 13% + IT 3% sin exención encontrada para servicios odontológicos privados | Integración con un proveedor autorizado en el roadmap (D-13); sin implementar |
| Pagos y QR | BCB RD 079/2022: el pago es final al acreditarse; las órdenes electrónicas tienen valor probatorio | Pago pendiente → verificado por otra persona; referencia única; conciliación en el roadmap |
| Mensajería | DS 1793, art. 57: opción de baja en mensajes comerciales; Ley 453 de consumidores | Recordatorios solo con consentimiento y sin datos clínicos; baja automática con la API oficial (B-010) |
| Residencia de datos | No se encontraron restricciones para clínicas privadas (sí para entidades públicas, DS 5322) | Hosting en la nube aceptable; región a definir con la clínica |

**Pendiente de verificación legal:** las 21 preguntas listadas en el anexo E, §10. Las prioritarias:
1. el alcance del DS 1793, art. 56;
2. la aplicación directa de la Ley 3131 a odontólogos;
3. el texto de la RM 0090/2008 y de la RM 0715/2017;
4. el consentimiento de adolescentes;
5. ser Proveedor SIAT o integrarse con un proveedor existente.

## Método

Ver `INVESTIGACION_COMPETIDORES.md` §2. Para repetir la investigación se necesita acceso de red a los dominios de los proveedores. En esta sesión se habilitaron con autorización del usuario.
