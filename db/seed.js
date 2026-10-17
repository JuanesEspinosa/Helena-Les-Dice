// Datos de ejemplo ficticios para probar la plataforma (los mismos que muestran las vistas)
const bcrypt = require('bcryptjs');
const { pool, tx } = require('../server/db');

const PASSWORD = 'Helena2026';

const LEVELS = [
  { name: 'Introducción', points: 100, description: 'Propósito, alcance, definiciones y referencias del documento.',
    sections: ['Propósito', 'Alcance', 'Personal involucrado', 'Definiciones, acrónimos y abreviaturas', 'Referencias', 'Resumen'] },
  { name: 'Descripción general', points: 150, description: 'Panorama completo del producto, sus usuarios y restricciones.',
    sections: ['Perspectiva del producto', 'Funcionalidad del producto', 'Características de los usuarios', 'Restricciones', 'Suposiciones y dependencias', 'Evolución previsible del sistema'] },
  { name: 'Requisitos específicos', points: 200, description: 'Requisitos funcionales y no funcionales del sistema.',
    sections: ['Requisitos comunes de las interfaces', 'Requisitos funcionales', 'Requisitos no funcionales', 'Otros requisitos'] },
  { name: 'Diseño del proyecto', points: 200, description: 'Diseño dinámico, estático y de la interfaz gráfica.',
    sections: ['Diseño dinámico', 'Diseño estático', 'Diseño GUI'] },
  { name: 'Anexos', points: 100, description: 'Material complementario del documento.',
    sections: ['Anexos'] },
];

const ACHIEVEMENTS = [
  ['Primer paso', 'Enviaron su primera sección a revisión.', 'rocket', 'first_submission', 0, 20],
  ['Primera aprobación', 'Lograron su primera sección aprobada.', 'checkCircle', 'first_approved', 0, 30],
  ['Nivel 1 superado', 'Completaron la Introducción del documento.', 'flag', 'level_completed', 1, 100],
  ['Nivel 2 superado', 'Completaron la Descripción general.', 'target', 'level_completed', 2, 150],
  ['Diez aprobadas', 'Aprobaron diez secciones del documento.', 'star', 'sections_approved', 10, 120],
  ['Oídos atentos', 'Atendieron cinco comentarios de retroalimentación.', 'message', 'comments_resolved', 5, 60],
  ['Bandeja limpia', 'Atendieron todos los comentarios pendientes.', 'sparkles', 'all_comments_resolved', 0, 80],
  ['Documento completo', 'Superaron todos los niveles del documento.', 'trophy', 'all_levels_completed', 0, 300],
];

const P = (t) => `<p>${t}</p>`;
const SAMPLE = {
  'Propósito': P('Este documento especifica los requisitos de la plataforma Helena les dice, una aplicación web educativa por niveles y gamificada para la asignatura Gestión de proyectos TI.'),
  'Alcance': P('La plataforma centraliza la redacción del documento IEEE 830 de cada equipo, registra los aportes individuales y ofrece a la docente un panel de seguimiento en tiempo real.'),
  'Perspectiva del producto': P('La aplicación es un producto independiente y autónomo. En esta etapa no se integra con los sistemas de matrícula ni de notas del Politécnico.'),
  'Funcionalidad del producto': P('Las funciones principales son: arquitectura por niveles, colaboración con control de versiones, monitoreo de aportes y retroalimentación proactiva de la docente.'),
  'Restricciones': P('La infraestructura deberá operar en servicios de capa gratuita o en servidores institucionales. El código debe ser modular y estar comentado.') + P('Se usará una base de datos relacional PostgreSQL.'),
};

(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  try {
    await tx(async (c) => {
      const ins = async (sql, params) => (await c.query(sql, params)).rows[0];

      // Periodos
      const p1 = await ins(`INSERT INTO periods (name, start_date, end_date, active) VALUES ('2026-1', '2026-02-02', '2026-06-12', FALSE) RETURNING id`);
      const p2 = await ins(`INSERT INTO periods (name, start_date, end_date, active) VALUES ('2026-2', '2026-08-03', '2026-12-04', TRUE) RETURNING id`);

      // Usuarios
      const user = (name, email, role, extra = '') => ins(
        `INSERT INTO users (name, email, password_hash, role, last_login${extra ? ', active' : ''})
         VALUES ($1, $2, $3, $4, now() - (random() * interval '3 days')${extra ? ', FALSE' : ''}) RETURNING id`,
        [name, email, hash, role]
      );
      const admin = await user('Víctor Marín', 'admin@elpoli.edu.co', 'administrador');
      const gladys = await user('Gladys Restrepo', 'gladys.restrepo@elpoli.edu.co', 'docente');
      await user('Hernán Ospina', 'hernan.ospina@elpoli.edu.co', 'docente');
      const names = [
        ['Laura Gómez', 'laura.gomez'], ['Camila Ríos', 'camila.rios'], ['Andrés Pérez', 'andres.perez'], ['Mateo Torres', 'mateo.torres'],
        ['Sofía Zapata', 'sofia.zapata'], ['Julián Castaño', 'julian.castano'], ['Valentina Mejía', 'valentina.mejia'], ['Santiago Ruiz', 'santiago.ruiz'],
        ['Daniela Henao', 'daniela.henao'], ['Kevin López', 'kevin.lopez'], ['Isabela Vélez', 'isabela.velez'], ['Tomás Arango', 'tomas.arango'],
        ['Mariana Cano', 'mariana.cano'], ['Felipe Osorio', 'felipe.osorio'],
      ];
      const st = {};
      for (const [n, e] of names) st[n] = (await user(n, `${e}@elpoli.edu.co`, 'estudiante')).id;
      await user('Paula Giraldo', 'paula.giraldo@elpoli.edu.co', 'estudiante', 'inactive');

      // Niveles y secciones de la plantilla
      const lsIds = {};
      for (const [i, lv] of LEVELS.entries()) {
        const l = await ins(`INSERT INTO levels (position, name, description, points) VALUES ($1, $2, $3, $4) RETURNING id`, [i + 1, lv.name, lv.description, lv.points]);
        for (const [j, s] of lv.sections.entries()) {
          lsIds[s] = (await ins(`INSERT INTO level_sections (level_id, position, name) VALUES ($1, $2, $3) RETURNING id`, [l.id, j + 1, s])).id;
        }
      }

      // Logros
      const achIds = {};
      for (const a of ACHIEVEMENTS) {
        achIds[a[0]] = (await ins(`INSERT INTO achievements (name, description, icon, criterion, param, points) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, a)).id;
      }

      // Equipos
      const team = async (name, project, period, members) => {
        const t = await ins(`INSERT INTO teams (name, project, period_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [name, project, period, gladys.id]);
        for (const m of members) await c.query(`INSERT INTO team_members (team_id, user_id, period_id) VALUES ($1, $2, $3)`, [t.id, st[m], period]);
        await c.query(`INSERT INTO sections (team_id, level_section_id) SELECT $1, id FROM level_sections`, [t.id]);
        return t.id;
      };
      const t3 = await team('Equipo 3', 'Helena les dice', p2.id, ['Laura Gómez', 'Camila Ríos', 'Andrés Pérez', 'Mateo Torres']);
      const t1 = await team('Equipo 1', 'EcoRuta: reciclaje urbano', p2.id, ['Julián Castaño', 'Valentina Mejía', 'Santiago Ruiz']);
      const t2 = await team('Equipo 2', 'MediTurnos: citas médicas', p2.id, ['Daniela Henao', 'Kevin López', 'Isabela Vélez']);
      await team('Equipo 4', 'BiblioPoli: préstamos', p2.id, ['Tomás Arango', 'Mariana Cano', 'Felipe Osorio']);
      await team('Equipo 5', 'AgroData', p1.id, ['Sofía Zapata']);

      const sec = async (teamId, name) => (await ins(`SELECT id FROM sections WHERE team_id = $1 AND level_section_id = $2`, [teamId, lsIds[name]])).id;
      const log = (u, t, s, action, detail, hoursAgo) => c.query(
        `INSERT INTO activity_log (user_id, team_id, section_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval)`,
        [u, t, s, action, detail, String(hoursAgo)]
      );

      // Avance del Equipo 3: nivel 1 aprobado y nivel 2 en curso (como en la vista 02)
      const plan3 = [
        ['Propósito', 'Laura Gómez', 'Camila Ríos', 'aprobado', 200], ['Alcance', 'Camila Ríos', 'Andrés Pérez', 'aprobado', 190],
        ['Personal involucrado', 'Andrés Pérez', 'Mateo Torres', 'aprobado', 180], ['Definiciones, acrónimos y abreviaturas', 'Mateo Torres', 'Laura Gómez', 'aprobado', 170],
        ['Referencias', 'Laura Gómez', 'Andrés Pérez', 'aprobado', 160], ['Resumen', 'Camila Ríos', 'Mateo Torres', 'aprobado', 150],
        ['Perspectiva del producto', 'Camila Ríos', 'Andrés Pérez', 'aprobado', 72], ['Funcionalidad del producto', 'Andrés Pérez', 'Mateo Torres', 'revision', 18],
        ['Características de los usuarios', 'Mateo Torres', 'Laura Gómez', 'redaccion', 3], ['Restricciones', 'Laura Gómez', 'Mateo Torres', 'devuelto', 1],
        ['Suposiciones y dependencias', 'Camila Ríos', 'Laura Gómez', 'redaccion', 16], ['Evolución previsible del sistema', 'Andrés Pérez', 'Camila Ríos', 'redaccion', 50],
      ];
      for (const [name, resp, rev, status, h] of plan3) {
        const id = await sec(t3, name);
        const content = SAMPLE[name] || P(`Borrador de la sección ${name.toLowerCase()} del Equipo 3.`);
        await c.query(
          `UPDATE sections SET responsible_id = $1, reviewer_id = $2, status = $3, content = $4, updated_at = now() - ($5 || ' hours')::interval, updated_by = $1 WHERE id = $6`,
          [st[resp], st[rev], status, content, String(h), id]
        );
        const v1 = content.replace(/\.<\/p>$/, '</p>');
        await c.query(`INSERT INTO section_versions (section_id, number, author_id, content, kind, created_at) VALUES ($1, 1, $2, $3, 'automatico', now() - ($4 || ' hours')::interval)`, [id, st[resp], v1, String(h + 6)]);
        await c.query(`INSERT INTO section_versions (section_id, number, author_id, content, kind, created_at) VALUES ($1, 2, $2, $3, $4, now() - ($5 || ' hours')::interval)`, [id, st[resp], content, status === 'redaccion' ? 'manual' : 'enviada', String(h)]);
        await log(st[resp], t3, id, 'guardo_version', `${name} · v2`, h + 1);
        if (status !== 'redaccion') await log(st[resp], t3, id, 'envio_revision', name, h);
        if (status === 'aprobado') await log(st[rev], t3, id, 'aprobo', name, h - 1);
        if (status === 'devuelto') await log(gladys.id, t3, id, 'devolvio', name, h);
      }
      await log(st['Laura Gómez'], t3, null, 'nivel_superado', 'Nivel 1 · Introducción', 149);

      // Comentarios
      const restr = await sec(t3, 'Restricciones');
      const func = await sec(t3, 'Funcionalidad del producto');
      await c.query(`INSERT INTO comments (section_id, author_id, body, quote, created_at) VALUES ($1, $2, $3, $4, now() - interval '2 hours')`,
        [restr, gladys.id, 'Indiquen qué servicio gratuito concreto usarán para el hosting.', 'servicios de capa gratuita']);
      await c.query(`INSERT INTO comments (section_id, author_id, body, created_at) VALUES ($1, $2, $3, now() - interval '20 hours')`,
        [func, st['Mateo Torres'], 'Revisa que cada área coincida con un requisito funcional.']);
      await c.query(`INSERT INTO comments (section_id, author_id, body, resolved, resolved_by, resolved_at, created_at) VALUES ($1, $2, $3, TRUE, $4, now() - interval '70 hours', now() - interval '90 hours')`,
        [await sec(t3, 'Perspectiva del producto'), gladys.id, 'Aclaren que no se integra con los sistemas institucionales.', st['Camila Ríos']]);

      // Logros ya ganados por el Equipo 3
      for (const [n, h] of [['Primer paso', 200], ['Primera aprobación', 199], ['Nivel 1 superado', 149]]) {
        await c.query(`INSERT INTO team_achievements (team_id, achievement_id, earned_at) VALUES ($1, $2, now() - ($3 || ' hours')::interval)`, [t3, achIds[n], String(h)]);
      }

      // Otros equipos: algo de avance para el panel docente
      for (const [tid, people, count] of [[t1, ['Julián Castaño', 'Valentina Mejía', 'Santiago Ruiz'], 3], [t2, ['Daniela Henao', 'Kevin López', 'Isabela Vélez'], 6]]) {
        const names1 = LEVELS[0].sections.slice(0, count);
        for (const [i, name] of names1.entries()) {
          const id = await sec(tid, name);
          const resp = people[i % people.length];
          const rev = people[(i + 1) % people.length];
          await c.query(`UPDATE sections SET responsible_id = $1, reviewer_id = $2, status = 'aprobado', content = $3, updated_at = now() - interval '30 hours' WHERE id = $4`,
            [st[resp], st[rev], P(`Contenido de ${name.toLowerCase()}.`), id]);
          await log(st[resp], tid, id, 'envio_revision', name, 40 + i);
          await log(st[rev], tid, id, 'aprobo', name, 30 + i);
        }
      }
      // Equipo 2 envió una sección del nivel 2 a revisión
      const t2s = await sec(t2, 'Perspectiva del producto');
      await c.query(`UPDATE sections SET responsible_id = $1, reviewer_id = $2, status = 'revision', content = $3, updated_at = now() - interval '5 hours' WHERE id = $4`,
        [st['Daniela Henao'], st['Kevin López'], P('MediTurnos es una aplicación web independiente para gestionar citas.'), t2s]);
      await log(st['Daniela Henao'], t2, t2s, 'envio_revision', 'Perspectiva del producto', 5);
      await c.query(`INSERT INTO team_achievements (team_id, achievement_id) VALUES ($1, $2), ($1, $3), ($1, $4)`, [t2, achIds['Primer paso'], achIds['Primera aprobación'], achIds['Nivel 1 superado']]);
      await c.query(`INSERT INTO team_achievements (team_id, achievement_id) VALUES ($1, $2), ($1, $3)`, [t1, achIds['Primer paso'], achIds['Primera aprobación']]);

      // Notificaciones de Laura
      const n = (uid, type, title, body, link, hoursAgo, read = false) => c.query(
        `INSERT INTO notifications (user_id, type, title, body, link, read, created_at) VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' hours')::interval)`,
        [uid, type, title, body, link, read, String(hoursAgo)]
      );
      await n(st['Laura Gómez'], 'devuelta', '"Restricciones" fue devuelta con observaciones', 'Gladys Restrepo: “Indiquen qué servicio gratuito concreto usarán para el hosting.”', `/editor.html?id=${restr}`, 1);
      await n(st['Laura Gómez'], 'comentario', 'Nuevo comentario en "Restricciones"', 'La docente dejó una observación sobre el hosting.', `/editor.html?id=${restr}`, 2);
      await n(st['Laura Gómez'], 'revision', 'Equipo 3 envió "Funcionalidad del producto" a revisión', 'Andrés Pérez espera la revisión de Mateo.', `/editor.html?id=${func}`, 18);
      await n(st['Laura Gómez'], 'aprobada', '"Perspectiva del producto" fue aprobada', 'Revisada por Andrés Pérez.', `/editor.html?id=${await sec(t3, 'Perspectiva del producto')}`, 70, true);
      await n(st['Laura Gómez'], 'nivel', '¡Se desbloqueó el nivel 2: Descripción general!', 'Superaron el nivel 1 · Introducción y ganaron 100 puntos.', '/estudiante/tablero.html', 149, true);
      await n(st['Laura Gómez'], 'insignia', '¡Ganaron la insignia "Nivel 1 superado"!', 'Completaron la Introducción del documento. · +100 puntos', '/estudiante/logros.html', 149, true);
      await n(gladys.id, 'revision', 'Equipo 2 envió "Perspectiva del producto" a revisión', 'Daniela Henao espera tu revisión.', `/editor.html?id=${t2s}`, 5);

      // Copias de seguridad de ejemplo
      await c.query(`INSERT INTO backups (kind, created_by, filename, size_bytes, status, error, created_at) VALUES
        ('automatica', NULL, 'helena-auto-ejemplo-1.sql.gz', 2411724, 'exitosa', NULL, now() - interval '6 days'),
        ('manual', $1, NULL, NULL, 'fallida', 'Espacio insuficiente en el servidor para generar el archivo comprimido.', now() - interval '9 days'),
        ('automatica', NULL, 'helena-auto-ejemplo-0.sql.gz', 2280110, 'exitosa', NULL, now() - interval '13 days')`, [admin.id]);
    });
    console.log('Datos de ejemplo cargados.');
    console.log(`Contraseña de todas las cuentas: ${PASSWORD}`);
    console.log('  Administrador: admin@elpoli.edu.co');
    console.log('  Docente:       gladys.restrepo@elpoli.edu.co');
    console.log('  Estudiante:    laura.gomez@elpoli.edu.co (Equipo 3)');
  } catch (err) {
    console.error('No se pudieron cargar los datos:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
