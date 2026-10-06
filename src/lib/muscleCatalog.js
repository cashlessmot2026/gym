// Catálogo base de ejercicios por grupo muscular. El cliente sin coach lo usa para armar su propia rutina.
// Los ejercicios que elija se guardan (si no existen) en la tabla `exercises` y se asignan en `assignments`.
export const MUSCLE_CATALOG = {
  Pecho: ['Press banca con barra', 'Press banca inclinado con mancuernas', 'Press banca declinado', 'Aperturas con mancuernas', 'Cruce de poleas', 'Flexiones', 'Fondos en paralelas', 'Pec deck (máquina)', 'Press en máquina', 'Pullover con mancuerna'],
  Espalda: ['Dominadas', 'Jalón al pecho', 'Remo con barra', 'Remo con mancuerna', 'Remo en polea baja', 'Peso muerto', 'Remo en máquina', 'Jalón agarre estrecho', 'Pullover en polea', 'Hiperextensiones'],
  Hombros: ['Press militar con barra', 'Press con mancuernas sentado', 'Elevaciones laterales', 'Elevaciones frontales', 'Pájaros (deltoide posterior)', 'Face pull', 'Press Arnold', 'Remo al mentón', 'Encogimientos de trapecio'],
  Brazos: ['Curl de bíceps con barra', 'Curl alterno con mancuernas', 'Curl martillo', 'Curl predicador', 'Curl en polea', 'Extensión de tríceps en polea', 'Press francés', 'Fondos en banco', 'Patada de tríceps', 'Curl de muñeca'],
  Piernas: ['Sentadilla con barra', 'Prensa de piernas', 'Extensión de cuádriceps', 'Curl femoral tumbado', 'Peso muerto rumano', 'Zancadas con mancuernas', 'Sentadilla búlgara', 'Sentadilla goblet', 'Hack squat', 'Sentadilla frontal'],
  Glúteos: ['Hip thrust', 'Puente de glúteos', 'Patada de glúteo en polea', 'Abducción en máquina', 'Sentadilla sumo', 'Peso muerto con piernas rígidas', 'Step-up con mancuernas', 'Good morning'],
  Pantorrillas: ['Elevación de talones de pie', 'Elevación de talones sentado', 'Elevación en prensa', 'Salto de cuerda', 'Elevación de talones a una pierna'],
  Abdomen: ['Plancha', 'Crunch abdominal', 'Elevación de piernas colgado', 'Rueda abdominal', 'Bicicleta abdominal', 'Plancha lateral', 'Crunch en polea', 'Russian twist', 'Mountain climbers', 'Hollow body'],
  Cardio: ['Trote en cinta', 'Caminata inclinada', 'Bicicleta estática', 'Elíptica', 'Remo ergómetro', 'Escaladora', 'Salto de cuerda', 'Burpees', 'Air bike', 'Sprints'],
  'Cuerpo completo': ['Thrusters', 'Kettlebell swing', 'Clean con mancuernas', 'Burpees', 'Wall balls', 'Farmer walk', 'Turkish get-up', 'Snatch con mancuerna'],
  Movilidad: ['Movilidad de cadera 90/90', 'Cat-camel', 'Rotaciones torácicas', 'Estiramiento de isquios', 'World greatest stretch', 'Movilidad de tobillo', 'Estiramiento de pecho en pared', 'Foam roller espalda']
}
