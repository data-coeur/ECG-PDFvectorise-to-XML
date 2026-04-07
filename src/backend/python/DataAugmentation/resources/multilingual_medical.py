"""
Multilingual medical text corpus for ECG label and annotation generation.

Provides phrases, patient names, and date formats for diverse scripts:
  Latin (EN/FR/DE/ES/PT/IT/TR), CJK (ZH/JA/KO), Arabic, Cyrillic (RU),
  Greek, Hindi (Devanagari)

Used by etiquette_aug.py and handwriting_aug.py.
"""

import os
import random
import logging
from PIL import ImageFont

logger = logging.getLogger(__name__)

# ── Script families and their weights (approximate global ECG archive distribution) ──

SCRIPT_WEIGHTS = {
    'latin':    0.50,   # EN, FR, DE, ES, PT, IT, TR
    'cjk':      0.15,   # ZH, JA, KO
    'arabic':   0.10,   # AR, FA
    'cyrillic': 0.10,   # RU, UK
    'greek':    0.05,
    'hindi':    0.05,
    'latin_accented': 0.05,  # Names/text with heavy diacritics
}

# ── Medical phrases per script ──

PHRASES = {
    # English
    'en': [
        "Normal sinus rhythm", "Sinus bradycardia", "Sinus tachycardia",
        "Atrial fibrillation", "Atrial flutter", "Regular rhythm",
        "Irregular rhythm", "Supraventricular tachycardia",
        "Heart rate 72 bpm", "HR 65 bpm", "Rate 80 bpm",
        "PR interval 160ms", "QRS duration 90ms", "QT interval 420ms",
        "Normal ECG", "Abnormal ECG", "Within normal limits",
        "No acute changes", "ST depression", "T wave inversion",
        "Left axis deviation", "Right axis deviation",
        "First degree AV block", "Left BBB", "Right BBB",
        "Poor R wave progression", "Low voltage",
        "Reviewed by", "Interpreted by", "Final report",
        "Routine ECG", "Serial ECG", "12-lead ECG",
    ],
    # French
    'fr': [
        "Rythme sinusal normal", "Bradycardie sinusale", "Tachycardie sinusale",
        "Fibrillation auriculaire", "Flutter auriculaire",
        "Rythme régulier", "Rythme irrégulier",
        "Tachycardie supraventriculaire", "Extrasystoles ventriculaires",
        "Fréquence cardiaque 72/min", "FC 65/min", "FC 80/min",
        "Intervalle PR 160ms", "Durée QRS 90ms", "Intervalle QT 420ms",
        "ECG normal", "ECG anormal", "Dans les limites normales",
        "Pas de modification aiguë", "Sous-décalage ST", "Inversion onde T",
        "Déviation axiale gauche", "Bloc de branche gauche",
        "Bloc auriculo-ventriculaire du 1er degré",
        "Interprété par", "Rapport final", "ECG de repos",
    ],
    # German
    'de': [
        "Normaler Sinusrhythmus", "Sinusbradykardie", "Sinustachykardie",
        "Vorhofflimmern", "Vorhofflattern", "Regelmäßiger Rhythmus",
        "Unregelmäßiger Rhythmus", "Supraventrikuläre Tachykardie",
        "Herzfrequenz 72/min", "HF 65/min",
        "PR-Intervall 160ms", "QRS-Dauer 90ms", "QT-Intervall 420ms",
        "Normales EKG", "Pathologisches EKG", "Innerhalb normaler Grenzen",
        "Keine akuten Veränderungen", "ST-Senkung", "T-Wellen-Inversion",
        "Linksachsenabweichung", "Linksschenkelblock", "Rechtsschenkelblock",
        "AV-Block I. Grades", "Befundet durch", "Ruhe-EKG",
    ],
    # Spanish
    'es': [
        "Ritmo sinusal normal", "Bradicardia sinusal", "Taquicardia sinusal",
        "Fibrilación auricular", "Aleteo auricular", "Ritmo regular",
        "Ritmo irregular", "Taquicardia supraventricular",
        "Frecuencia cardíaca 72 lpm", "FC 65 lpm",
        "Intervalo PR 160ms", "Duración QRS 90ms", "Intervalo QT 420ms",
        "ECG normal", "ECG anormal", "Dentro de límites normales",
        "Sin cambios agudos", "Depresión ST", "Inversión onda T",
        "Desviación del eje a la izquierda", "Bloqueo de rama izquierda",
        "Bloqueo auriculoventricular de primer grado",
        "Interpretado por", "Informe final", "ECG de reposo",
    ],
    # Portuguese
    'pt': [
        "Ritmo sinusal normal", "Bradicardia sinusal", "Taquicardia sinusal",
        "Fibrilação atrial", "Flutter atrial", "Ritmo regular",
        "Ritmo irregular", "Taquicardia supraventricular",
        "Frequência cardíaca 72 bpm", "FC 65 bpm",
        "Intervalo PR 160ms", "Duração QRS 90ms", "Intervalo QT 420ms",
        "ECG normal", "ECG anormal", "Dentro dos limites normais",
        "Sem alterações agudas", "Depressão ST", "Inversão onda T",
        "Desvio do eixo à esquerda", "Bloqueio de ramo esquerdo",
        "Interpretado por", "Relatório final", "ECG de repouso",
    ],
    # Italian
    'it': [
        "Ritmo sinusale normale", "Bradicardia sinusale", "Tachicardia sinusale",
        "Fibrillazione atriale", "Flutter atriale", "Ritmo regolare",
        "Ritmo irregolare", "Tachicardia sopraventricolare",
        "Frequenza cardiaca 72 bpm", "FC 65 bpm",
        "Intervallo PR 160ms", "Durata QRS 90ms", "Intervallo QT 420ms",
        "ECG normale", "ECG anormale", "Nei limiti della norma",
        "Nessun cambiamento acuto", "Sottoslivellamento ST", "Inversione onda T",
        "Deviazione assiale sinistra", "Blocco di branca sinistro",
        "Interpretato da", "Referto finale", "ECG a riposo",
    ],
    # Turkish
    'tr': [
        "Normal sinüs ritmi", "Sinüs bradikardisi", "Sinüs taşikardisi",
        "Atriyal fibrilasyon", "Atriyal flutter", "Düzenli ritim",
        "Düzensiz ritim", "Supraventriküler taşikardi",
        "Kalp hızı 72/dk", "KH 65/dk",
        "PR aralığı 160ms", "QRS süresi 90ms", "QT aralığı 420ms",
        "Normal EKG", "Anormal EKG", "Normal sınırlar içinde",
        "Akut değişiklik yok", "ST çökmesi", "T dalga inversiyonu",
        "Sol aks sapması", "Sol dal bloğu", "Sağ dal bloğu",
        "Yorumlayan", "Son rapor", "İstirahat EKG'si",
    ],
    # Chinese (Simplified)
    'zh': [
        "正常窦性心律", "窦性心动过缓", "窦性心动过速",
        "心房颤动", "心房扑动", "规则心律", "不规则心律",
        "室上性心动过速", "心率72次/分", "心率65次/分",
        "PR间期160ms", "QRS时限90ms", "QT间期420ms",
        "正常心电图", "异常心电图", "在正常范围内",
        "无急性改变", "ST段压低", "T波倒置",
        "电轴左偏", "左束支传导阻滞", "右束支传导阻滞",
        "一度房室传导阻滞", "报告医师", "静息心电图",
    ],
    # Japanese
    'ja': [
        "正常洞調律", "洞性徐脈", "洞性頻脈",
        "心房細動", "心房粗動", "整脈", "不整脈",
        "上室性頻拍", "心拍数72回/分", "心拍数65回/分",
        "PR間隔160ms", "QRS幅90ms", "QT間隔420ms",
        "正常心電図", "異常心電図", "正常範囲内",
        "急性変化なし", "ST低下", "T波陰転",
        "左軸偏位", "左脚ブロック", "右脚ブロック",
        "I度房室ブロック", "判読医", "安静時心電図",
    ],
    # Korean
    'ko': [
        "정상 동율동", "동성 서맥", "동성 빈맥",
        "심방세동", "심방조동", "규칙적 리듬", "불규칙적 리듬",
        "상심실성 빈맥", "심박수 72회/분", "심박수 65회/분",
        "PR 간격 160ms", "QRS 기간 90ms", "QT 간격 420ms",
        "정상 심전도", "비정상 심전도", "정상 범위 내",
        "급성 변화 없음", "ST 하강", "T파 역전",
        "좌축 편위", "좌각 차단", "우각 차단",
        "1도 방실 차단", "판독의", "안정시 심전도",
    ],
    # Arabic
    'ar': [
        "نظم جيبي طبيعي", "بطء القلب الجيبي", "تسرع القلب الجيبي",
        "رجفان أذيني", "رفرفة أذينية", "نظم منتظم", "نظم غير منتظم",
        "تسرع فوق بطيني", "معدل ضربات القلب 72/دقيقة",
        "فترة PR 160 مللي ثانية", "مدة QRS 90 مللي ثانية",
        "تخطيط قلب طبيعي", "تخطيط قلب غير طبيعي",
        "لا تغييرات حادة", "انخفاض ST", "انقلاب موجة T",
        "انحراف المحور الأيسر", "إحصار الحزمة اليسرى",
        "إحصار أذيني بطيني من الدرجة الأولى",
        "تم التفسير بواسطة", "التقرير النهائي", "تخطيط القلب أثناء الراحة",
    ],
    # Russian
    'ru': [
        "Нормальный синусовый ритм", "Синусовая брадикардия", "Синусовая тахикардия",
        "Фибрилляция предсердий", "Трепетание предсердий",
        "Регулярный ритм", "Нерегулярный ритм",
        "Суправентрикулярная тахикардия", "ЧСС 72 уд/мин", "ЧСС 65 уд/мин",
        "Интервал PR 160мс", "Длительность QRS 90мс", "Интервал QT 420мс",
        "Нормальная ЭКГ", "Патологическая ЭКГ", "В пределах нормы",
        "Без острых изменений", "Депрессия ST", "Инверсия зубца Т",
        "Отклонение оси влево", "Блокада левой ножки пучка Гиса",
        "АВ-блокада I степени", "Интерпретировано", "ЭКГ покоя",
    ],
    # Greek
    'el': [
        "Φυσιολογικός φλεβοκομβικός ρυθμός", "Φλεβοκομβική βραδυκαρδία",
        "Φλεβοκομβική ταχυκαρδία", "Κολπική μαρμαρυγή", "Κολπικός πτερυγισμός",
        "Κανονικός ρυθμός", "Ακανόνιστος ρυθμός",
        "Υπερκοιλιακή ταχυκαρδία", "Καρδιακή συχνότητα 72/λεπτό",
        "Διάστημα PR 160ms", "Διάρκεια QRS 90ms",
        "Φυσιολογικό ΗΚΓ", "Παθολογικό ΗΚΓ", "Εντός φυσιολογικών ορίων",
        "Χωρίς οξείες αλλαγές", "Κατάσπαση ST", "Αναστροφή κύματος Τ",
        "Αριστερή απόκλιση άξονα", "Αριστερός σκελικός αποκλεισμός",
        "ΗΚΓ ηρεμίας",
    ],
    # Hindi
    'hi': [
        "सामान्य साइनस लय", "साइनस ब्रैडीकार्डिया", "साइनस टैकीकार्डिया",
        "आलिंद तंतुविकसन", "आलिंद स्पंदन", "नियमित लय", "अनियमित लय",
        "सुप्रावेंट्रिकुलर टैकीकार्डिया", "हृदय गति 72/मिनट",
        "PR अंतराल 160ms", "QRS अवधि 90ms", "QT अंतराल 420ms",
        "सामान्य ईसीजी", "असामान्य ईसीजी", "सामान्य सीमा के भीतर",
        "कोई तीव्र परिवर्तन नहीं", "ST अवनमन", "T तरंग उलटाव",
        "बायां अक्ष विचलन", "बायां बंडल शाखा ब्लॉक",
        "व्याख्या किसके द्वारा", "विश्राम ईसीजी",
    ],
}

# ── Patient names per script ──

NAMES = {
    'en': [
        "Smith, J.", "Brown, A.", "Jones, M.", "Davis, R.", "Wilson, T.",
        "Taylor, K.", "Anderson, L.", "Thompson, S.", "Martin, D.", "White, C.",
    ],
    'fr': [
        "Dupont, M.", "Martin, J.", "Bernard, P.", "Petit, A.", "Durand, L.",
        "Moreau, C.", "Laurent, É.", "Lefèvre, N.", "Garnier, S.", "Roux, F.",
    ],
    'de': [
        "Müller, H.", "Schmidt, K.", "Schneider, W.", "Fischer, A.", "Weber, M.",
        "Wagner, T.", "Becker, S.", "Schäfer, L.", "Hoffmann, R.", "Koch, P.",
    ],
    'es': [
        "García, M.", "Rodríguez, J.", "Martínez, A.", "López, C.", "González, R.",
        "Hernández, L.", "Pérez, S.", "Sánchez, F.", "Ramírez, D.", "Torres, P.",
    ],
    'pt': [
        "Silva, M.", "Santos, J.", "Oliveira, A.", "Souza, R.", "Pereira, C.",
        "Costa, L.", "Rodrigues, F.", "Almeida, S.", "Nascimento, D.", "Araújo, P.",
    ],
    'it': [
        "Rossi, M.", "Russo, G.", "Ferrari, A.", "Esposito, L.", "Bianchi, S.",
        "Romano, P.", "Colombo, F.", "Ricci, D.", "Marino, C.", "Greco, R.",
    ],
    'tr': [
        "Yılmaz, A.", "Kaya, M.", "Demir, H.", "Çelik, S.", "Şahin, E.",
        "Öztürk, B.", "Aydın, K.", "Özdemir, F.", "Arslan, T.", "Doğan, R.",
    ],
    'zh': [
        "王 伟", "李 芳", "张 强", "刘 洋", "陈 静",
        "杨 明", "赵 丽", "黄 磊", "周 敏", "吴 刚",
    ],
    'ja': [
        "田中 太郎", "鈴木 花子", "佐藤 一郎", "高橋 美咲", "渡辺 健二",
        "伊藤 由美", "山本 大輔", "中村 直子", "小林 誠", "加藤 真理",
    ],
    'ko': [
        "김민수", "이영희", "박준호", "최수진", "정대현",
        "강미영", "조현우", "윤서연", "장동혁", "임지은",
    ],
    'ar': [
        "محمد أحمد", "فاطمة علي", "عبدالله حسن", "نورة سعيد", "خالد إبراهيم",
        "مريم يوسف", "عمر محمود", "سارة عبدالرحمن", "أحمد الشريف", "ليلى الحسيني",
    ],
    'ru': [
        "Иванов И.П.", "Петрова А.С.", "Сидоров М.В.", "Козлова Е.Н.", "Новиков Д.А.",
        "Морозова О.И.", "Волков К.С.", "Соколова Т.М.", "Лебедев В.Г.", "Попова Н.Л.",
    ],
    'el': [
        "Παπαδόπουλος Γ.", "Νικολάου Μ.", "Αντωνίου Κ.", "Γεωργίου Α.", "Δημητρίου Σ.",
    ],
    'hi': [
        "शर्मा, अ.", "सिंह, र.", "गुप्ता, स.", "कुमार, व.", "पटेल, म.",
    ],
}

# ── Date formats per language ──

DATE_FORMATS = {
    'en': ["{d:02d}/{m:02d}/{y}", "{m:02d}/{d:02d}/{y}", "{y}-{m:02d}-{d:02d}"],
    'fr': ["{d:02d}/{m:02d}/{y}", "{d:02d}.{m:02d}.{y}"],
    'de': ["{d:02d}.{m:02d}.{y}", "{y}-{m:02d}-{d:02d}"],
    'es': ["{d:02d}/{m:02d}/{y}", "{d:02d}-{m:02d}-{y}"],
    'pt': ["{d:02d}/{m:02d}/{y}"],
    'it': ["{d:02d}/{m:02d}/{y}"],
    'tr': ["{d:02d}.{m:02d}.{y}", "{d:02d}/{m:02d}/{y}"],
    'zh': ["{y}年{m:02d}月{d:02d}日", "{y}/{m:02d}/{d:02d}"],
    'ja': ["{y}年{m:02d}月{d:02d}日", "{y}/{m:02d}/{d:02d}"],
    'ko': ["{y}년 {m:02d}월 {d:02d}일", "{y}.{m:02d}.{d:02d}"],
    'ar': ["{d:02d}/{m:02d}/{y}", "{y}/{m:02d}/{d:02d}"],
    'ru': ["{d:02d}.{m:02d}.{y}"],
    'el': ["{d:02d}/{m:02d}/{y}"],
    'hi': ["{d:02d}/{m:02d}/{y}"],
}

# ── Doctor title per language ──

DOCTOR_TITLES = {
    'en': "Dr.", 'fr': "Dr.", 'de': "Dr.", 'es': "Dr.", 'pt': "Dr.", 'it': "Dott.",
    'tr': "Dr.", 'zh': "医师", 'ja': "医師", 'ko': "의사",
    'ar': "د.", 'ru': "Д-р", 'el': "Δρ.", 'hi': "डॉ.",
}

# ── Map script families to language lists ──

SCRIPT_TO_LANGS = {
    'latin':          ['en', 'fr', 'de', 'es', 'pt', 'it'],
    'latin_accented':  ['tr', 'de', 'fr', 'es', 'pt'],
    'cjk':            ['zh', 'ja', 'ko'],
    'arabic':         ['ar'],
    'cyrillic':       ['ru'],
    'greek':          ['el'],
    'hindi':          ['hi'],
}

# ── Font resolution for each script ──

_FONT_CACHE = {}  # script -> font_path

_FONT_CANDIDATES = {
    'latin': [
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    'cjk': [
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    'arabic': [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/GeezaPro.ttc",
    ],
    'cyrillic': [
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    'greek': [
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ],
    'hindi': [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Kohinoor.ttc",
    ],
    'latin_accented': [
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ],
}


def resolve_font_for_script(script, size=20):
    """Resolve and cache a font that supports the given script family.

    Tests actual glyph rendering to avoid tofu (missing glyph rectangles).
    """
    if script not in _FONT_CACHE:
        # Test string per script — MUST include Latin+digits since labels mix them
        _test_strings = {
            'latin': 'ABCabc 123 #42',
            'cjk': '心電図 ECG #123',
            'arabic': '#42 مريم يوسف F 65',
            'cyrillic': 'Пациент ЭКГ #123',
            'greek': 'Ασθενής ΗΚΓ #123',
            'hindi': 'रोगी ईसीजी #123',
            'latin_accented': 'éàüñçş ABC 123',
        }
        test_str = _test_strings.get(script, 'ABCabc 123')

        candidates = _FONT_CANDIDATES.get(script, _FONT_CANDIDATES['latin'])
        best_path = None
        best_score = 0
        for path in candidates:
            try:
                font = ImageFont.truetype(path, size=24)
                from PIL import Image as _Img, ImageDraw as _Draw
                import numpy as _np
                _img = _Img.new('L', (600, 50), 255)
                _d = _Draw.Draw(_img)
                _d.text((5, 5), test_str, font=font, fill=0)
                arr = _np.array(_img)
                # Count columns that have any dark pixel (= rendered glyph width)
                col_has_ink = (arr < 128).any(axis=0)
                ink_cols = col_has_ink.sum()
                # Best font = most ink columns (widest actual rendering)
                if ink_cols > best_score:
                    best_score = ink_cols
                    best_path = path
            except Exception:
                continue
        if best_path and best_score > 20:
            _FONT_CACHE[script] = best_path
        else:
            _FONT_CACHE[script] = ""  # sentinel

    path = _FONT_CACHE[script]
    if path:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    # No font for this script — fall back to Latin (always readable)
    if script != 'latin':
        logger.warning(f"No font found for script '{script}', falling back to Latin")
        return resolve_font_for_script('latin', size)
    return ImageFont.load_default()


def pick_language():
    """Pick a random language weighted by script distribution."""
    scripts = list(SCRIPT_WEIGHTS.keys())
    weights = list(SCRIPT_WEIGHTS.values())
    script = random.choices(scripts, weights=weights)[0]
    langs = SCRIPT_TO_LANGS[script]
    lang = random.choice(langs)
    return lang, script


def get_random_phrase(lang=None):
    """Get a random medical phrase, optionally for a specific language."""
    if lang is None:
        lang, _ = pick_language()
    phrases = PHRASES.get(lang, PHRASES['en'])
    return random.choice(phrases), lang


def get_random_name(lang=None):
    """Get a random patient name for a given language."""
    if lang is None:
        lang, _ = pick_language()
    names = NAMES.get(lang, NAMES['en'])
    return random.choice(names), lang


def get_random_date(lang=None):
    """Get a random date string in the locale format."""
    if lang is None:
        lang, _ = pick_language()
    fmt = random.choice(DATE_FORMATS.get(lang, DATE_FORMATS['en']))
    d = random.randint(1, 28)
    m = random.randint(1, 12)
    y = random.randint(2022, 2025)
    return fmt.format(d=d, m=m, y=y), lang


def get_doctor_title(lang):
    """Get the doctor title for a language."""
    return DOCTOR_TITLES.get(lang, "Dr.")


def get_script_for_lang(lang):
    """Return the script family for a language code."""
    for script, langs in SCRIPT_TO_LANGS.items():
        if lang in langs:
            return script
    return 'latin'
