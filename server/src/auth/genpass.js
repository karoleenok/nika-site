import { randomInt } from 'node:crypto';

// Пароль, который админ выдаёт клиенту: слово-слово-цифры, латиницей, чтобы легко набрать с телефона.
// Слова короткие, без букв, которые путают при наборе. Выбор через crypto.randomInt, не Math.random.
const WORDS = `sosna reka gora more nebo luna zima leto vesna osen utro vecher polden veter volna bereg
ostrov ozero pole les sad dom most park gorod ulica doroga tropa kamen pesok trava list cvetok roza
mak klen dub iva buk lipa vishnya malina sliva grusha limon mango kivi banan arbuz dynya tykva morkov
perec tomat ogurec salat ukrop myata kofe kakao moloko sok voda led sneg dozhd grom tuman rosa raduga
zvezda kometa planeta raketa sputnik orbita kosmos solnce zarya zakat rassvet ten svet ogon iskra
plamya koster dym par oblako tucha groza buran metel inej moroz teplo zhara priboj liman zaliv buhta
mys rif skala utes holm ovrag dolina stepi tundra tajga dzhungli savanna oazis kanon vulkan gejzer
rodnik ruchej potok vodopad prud kanal port prichal mayak parus lodka kater yahta korabl yakor
kompas karta globus atlas marshrut pohod palatka ryukzak fonar spichki kotelok kruzhka lozhka nozh
topor pila molotok gvozd bolt gajka klyuch zamok dver okno krysha stena pol potolok lampa stol stul
divan kreslo polka shkaf kover zerkalo chasy budilnik radio gitara flejta skripka baraban truba
arfa royal nota akkord ritm melodiya pesnya tanec vals tango balet opera teatr kino kadr film
kniga tetrad ruchka karandash kraski kist holst mozaika uzor ornament kruzhevo nitka igla tkan
shelk hlopok len sherst sviter sharf shapka perchatki kurtka plash zont sapogi kedy tufli sumka
koshelek moneta rubin almaz zhemchug yantar korall biser kolco braslet busy brosh medal kubok
priz pobeda start finish beg pryzhok zaplyv match gol myach shajba klyushka raketka setka ring
kover gantel shtanga turnik skakalka obruch planka most shpagat balans sila tonus energiya
tigr lev pantera rys volk lisa zayac belka ezh bober vydra enot barsuk olen los kaban medved
panda koala kenguru zebra zhiraf slon nosorog begemot lama verblyud poni loshad osel koza ovca
korova byk kot koshka sobaka shchenok kotenok homyak popugaj kanarejka golub vorobej sinica
snegir dyatel sova filin orel sokol yastreb lebed gus utka caplya aist zhuravl pavlin flamingo
pingvin chajka delfin kit akula tyulen morzh krab omar krevetka meduza osminog kalmar karas
shchuka okun som forel losos babochka strekoza pchela shmel muravej kuznechik sverchok zhuk`
  .split(/\s+/).filter((w, i, a) => w && a.indexOf(w) === i);

const pick = () => WORDS[randomInt(WORDS.length)];

export function generateClientPassword() {
  let a = pick(), b = pick();
  while (b === a) b = pick();
  return `${a}-${b}-${String(randomInt(10000)).padStart(4, '0')}`;
}
export const WORD_COUNT = WORDS.length;
