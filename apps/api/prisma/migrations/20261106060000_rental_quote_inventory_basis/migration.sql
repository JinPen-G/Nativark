-- Keep legacy quotes unchanged: current configuration cannot reconstruct their original composition.
ALTER TABLE `rental_quotes`
  ADD COLUMN `inventoryBasis` JSON NULL;
