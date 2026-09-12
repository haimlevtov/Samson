/**
 * What the picker needs about a row the user already owns.
 *
 * A structural type rather than an import of `userEquipment`'s return: that
 * reader also carries a `slug`, which this component does not use, and naming
 * only what is read keeps the two free to diverge.
 */
export interface OwnedEquipment {
  tagId: string;
  maxLoadKg: number | null;
}
