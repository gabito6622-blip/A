---
name: gabostore-equipos
description: Trabajo grande en Gabriel Store / GaboHub (o en Dentalia) repartido en equipos de Claude en paralelo, cada uno aislado en su copia del repositorio, con integración, pruebas completas y revisión en celular antes de subir. Usar cuando el dueño pide varias mejoras a la vez, «sorprendeme», «fijate qué falta» o una versión nueva.
---

# Equipos en paralelo: repartir, aislar, integrar y probar

Sirve para pedidos grandes: varias áreas a la vez, una versión nueva o «fijate qué falta y hacelo». Para un arreglo chico, trabajá directo, sin equipos.

## 0. Antes de lanzar
1. **Avisá el costo.** Cada equipo es otra copia de Claude y consume uso de la cuenta del dueño. Decile en una frase cuántos equipos vas a abrir y para qué. Si el dueño pidió cuidar el consumo, trabajá vos solo, en tandas.
2. **Partí de una base sana:** `git status` limpio y `npm test` en verde en la rama de la sesión. Anotá cuántas pruebas pasan.
3. **Elegí qué hacer** mirando, en este orden:
   - el `docs/BACKLOG.md`;
   - los riesgos de `docs/IMPLEMENTATION_PLAN.md`;
   - lo que vivirían el cliente que compra, el revendedor, quien atiende GaboHub y el dueño.

   Nada que dependa de cuentas, claves o decisiones del dueño: eso va a una lista para él.

## 1. Repartir
- **Entre 2 y 4 equipos**, cada uno con un tema que toque **archivos distintos**.
- **Juntá en un mismo equipo** dos temas que tocan el mismo módulo de `src/store/`.
- **Archivos calientes:** `src/store/types.ts`, `src/server/app.ts`, `public/panel.js` y `public/shop.js` solo admiten cambios mínimos de cada equipo.
- **Asigná a cada equipo:**
  - un puerto propio (8101, 8102…);
  - una carpeta de datos temporal propia;
  - en Dentalia, además, número de migración, bases de datos y puerto.

## 2. Lanzar
- **Usá la herramienta Agent** con `isolation: "worktree"` y `run_in_background: true`, todos en un mismo mensaje.
- **El encargo de cada uno empieza así:** «Leé completo `docs/equipos/ENCARGO_COMUN.md` y cumplilo; tu rama base es `<rama de la sesión>`» (en Dentalia: `dental/docs/equipos/ENCARGO_COMUN_DENTALIA.md`).
- **Después del encargo común va lo específico:**
  - objetivo y por qué;
  - archivos a leer primero;
  - requisitos numerados;
  - qué pruebas espero;
  - asignaciones de puerto y datos.

  Un buen encargo es concreto y verificable. Si no lo podés escribir claro, todavía no entendés la tarea.
- **Mientras trabajan, no toques sus temas.** Hacé lo que no choca: documentación, revisar el backlog, preparar la integración.

## 3. Integrar (de a un equipo, cuando cada uno termina)
1. Leé su informe completo y desconfiá de lo que diga «listo» sin números.
2. `git merge --no-ff <rama-del-equipo>` en la rama de la sesión. Los conflictos en archivos calientes se resuelven **conservando lo de los dos lados**, con cuidado y nunca a ciegas.
3. Corré `npm test` **completo**. Lo que se rompió por la mezcla lo arreglás vos, con una prueba que lo cubra.
4. **Revisión visual con datos de ejemplo:**
   - tienda y GaboHub a 360, 390 y 768 px, en claro y oscuro (`scripts/revision-celular.cjs`);
   - entrá como dueño, admin, vendedor, revendedor y cliente;
   - abrí las pantallas nuevas y mirá las capturas de verdad.
5. Commit de la integración y push a la rama de la sesión. Revisá la CI.
6. Borrá el worktree y la rama del equipo: `git worktree remove` y `git branch -D`.

Si el dueño detiene un equipo, no lo vuelvas a lanzar por tu cuenta. Guardá su avance como commit local en su rama, sin push, y preguntale si querés que lo retomes vos.

## 4. Cerrar la tanda
- **Documentación:**
  - `docs/CHANGELOG.md`: qué cambió, en palabras del dueño;
  - `docs/INFORME_PRUEBAS.md`: totales antes y después, qué se probó y qué no;
  - `docs/DECISIONES.md`;
  - `docs/BACKLOG.md`: marcar lo hecho y sumar lo nuevo;
  - `docs/ROADMAP.md` si cambia el rumbo.
- **Informe al dueño**, corto y sin jerga:
  1. qué quedó hecho;
  2. pruebas: cuántas y en qué resultado;
  3. qué encontraste y arreglaste al integrar;
  4. qué necesita decidir o conseguir él, en lista.

  Nunca digas «terminado» sin las pruebas corridas, ni «publicado» sin su «Publicá».
