/**
 * The keyword table: the lexer's part of the dialect profile (Doc 01 §16). Every word here is
 * reserved from Phase 1 on, including those whose statements arrive later, so that no Phase 1
 * program breaks when a later phase adds them (Doc 01 §3).
 */
export interface KeywordTable {
  /** Every keyword, spelled canonically: upper case, with `$` where it has one. */
  keywords: ReadonlySet<string>
  /** The keywords without a trailing `$`. None of these may be a name, with or without a sigil. */
  reserved: ReadonlySet<string>
}

const PHASE_1 =
  'ABS AND ASC ATN CHR$ CLS COS DATA DIM ELSE END EXP FIX FOR GOSUB GOTO IF INPUT INSTR INT ' +
  'LCASE$ LEFT$ LEN LET LOG MAX MID$ MIN MOD NEXT NOT ON OR PRINT RANDOMIZE READ REM RESTORE ' +
  'RETURN RIGHT$ RND ROUND SGN SIN SPACE$ SQR STEP STOP STR$ STRING$ TAB TAN THEN TIMER TO TRIM$ ' +
  'UCASE$ VAL'
const LEVEL_2 =
  'BAND BASE BNOT BOR BXOR CALL CASE CLASSICPRINT CONST DO ELSEIF EXIT FUNCTION LOOP OPTION ' +
  'SELECT SUB UNTIL WEND WHILE'
const IO =
  'APPEND AS BEEP CIRCLE CLOSE COLOR EOF INKEY$ KEY LINE LOCATE OPEN OUTPUT PAINT PEEK POKE ' +
  'PSET SCREEN SOUND'
const GUI =
  'ASKBOX BUTTON CHANGE CHECKBOX CHECKED CLICK ENABLE FOCUS GETTEXT$ HIDE LABEL LISTADD LISTBOX ' +
  'LISTCLEAR LISTITEM$ LISTSEL MSGBOX SETTEXT SHOW TEXTBOX WAIT WINDOW'
/** Kept free for a possible ON ERROR (Master Design §8.6). */
const ALSO = 'ERROR'

const words = (list: string): string[] => list.split(' ')

/** The keywords whose statements or functions exist in Phase 1. */
export const PHASE_1_KEYWORDS: ReadonlySet<string> = new Set(words(PHASE_1))

const ALL = [PHASE_1, LEVEL_2, IO, GUI, ALSO].flatMap(words)

export const IGNITION_KEYWORDS: KeywordTable = {
  keywords: new Set(ALL),
  reserved: new Set(ALL.map((k) => k.replace(/\$$/, ''))),
}
