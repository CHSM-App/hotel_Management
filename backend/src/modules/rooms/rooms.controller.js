const fs = require('fs');
const path = require('path');
const { createRoomSchema, updateRoomSchema, statusSchema } = require('./rooms.schema');
const roomsService = require('./rooms.service');
const { ApiError } = require('../../middleware/errorHandler');
const { UPLOAD_DIR: ROOM_IMAGE_DIR } = require('../../middleware/roomImageUpload');

async function listRoomsHandler(req, res, next) {
  try {
    const rooms = await roomsService.listRooms(req.user.lodgeId);
    res.json({ rooms });
  } catch (err) {
    next(err);
  }
}

async function createRoomHandler(req, res, next) {
  const files = req.files || [];
  const cleanupUploads = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };
  try {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await roomsService.createRooms(req.user.lodgeId, parsed.data);

    // A bulk range creates several distinct rooms at once — there's no single
    // room to attach uploaded photos to, so photos only apply to a single
    // room creation.
    if (files.length > 0 && result.roomIds.length === 1) {
      await roomsService.addRoomImages(req.user.lodgeId, Number(result.roomIds[0]), files.map((f) => f.filename));
    } else if (files.length > 0) {
      cleanupUploads();
    }

    res.status(201).json(result);
  } catch (err) {
    cleanupUploads();
    next(err);
  }
}

async function updateRoomHandler(req, res, next) {
  const files = req.files || [];
  const cleanupUploads = () => {
    for (const file of files) fs.unlink(file.path, () => {});
  };
  try {
    const parsed = updateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const roomId = Number(req.params.id);
    const result = await roomsService.updateRoom(req.user.lodgeId, roomId, parsed.data);

    if (files.length > 0) {
      await roomsService.addRoomImages(req.user.lodgeId, roomId, files.map((f) => f.filename));
    }

    res.json(result);
  } catch (err) {
    cleanupUploads();
    next(err);
  }
}

async function deleteRoomImageHandler(req, res, next) {
  try {
    const filename = await roomsService.deleteRoomImage(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.imageId)
    );
    fs.unlink(path.join(ROOM_IMAGE_DIR, filename), () => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function updateRoomStatusHandler(req, res, next) {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }

    const result = await roomsService.setRoomActive(req.user.lodgeId, Number(req.params.id), parsed.data.isActive);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteRoomHandler(req, res, next) {
  try {
    const imageFilenames = await roomsService.deleteRoom(req.user.lodgeId, Number(req.params.id));
    for (const filename of imageFilenames) {
      fs.unlink(path.join(ROOM_IMAGE_DIR, filename), () => {});
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRoomsHandler,
  createRoomHandler,
  updateRoomHandler,
  updateRoomStatusHandler,
  deleteRoomHandler,
  deleteRoomImageHandler,
};
