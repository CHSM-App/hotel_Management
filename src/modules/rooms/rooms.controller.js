const fs = require('fs');
const path = require('path');
const { createRoomSchema, updateRoomSchema, statusSchema, checkoutPolicySchema } = require('./rooms.schema');
const { createBedSchema, updateBedSchema, bedCountSchema } = require('./beds.schema');
const roomsService = require('./rooms.service');
const checkoutPolicyService = require('./checkoutPolicy.service');
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

async function getCheckoutPolicyHandler(req, res, next) {
  try {
    const policy = await checkoutPolicyService.getCheckoutPolicy(req.user.lodgeId);
    res.json({ policy });
  } catch (err) {
    next(err);
  }
}

async function updateCheckoutPolicyHandler(req, res, next) {
  try {
    const parsed = checkoutPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const policy = await checkoutPolicyService.updateCheckoutPolicy(req.user.lodgeId, parsed.data);
    res.json({ policy });
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

async function listBedsHandler(req, res, next) {
  try {
    const beds = await roomsService.listBeds(req.user.lodgeId, Number(req.params.id));
    res.json({ beds });
  } catch (err) {
    next(err);
  }
}

async function createBedHandler(req, res, next) {
  try {
    const parsed = createBedSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const bed = await roomsService.createBed(req.user.lodgeId, Number(req.params.id), parsed.data);
    res.status(201).json({ bed });
  } catch (err) {
    next(err);
  }
}

async function updateBedHandler(req, res, next) {
  try {
    const parsed = updateBedSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const result = await roomsService.updateBed(
      req.user.lodgeId,
      Number(req.params.id),
      Number(req.params.bedId),
      parsed.data
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function deleteBedHandler(req, res, next) {
  try {
    await roomsService.deleteBed(req.user.lodgeId, Number(req.params.id), Number(req.params.bedId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function setBedCountHandler(req, res, next) {
  try {
    const parsed = bedCountSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(parsed.error.issues[0].message, 400);
    }
    const beds = await roomsService.setBedCount(req.user.lodgeId, Number(req.params.id), parsed.data.count);
    res.json({ beds });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRoomsHandler,
  getCheckoutPolicyHandler,
  updateCheckoutPolicyHandler,
  createRoomHandler,
  updateRoomHandler,
  updateRoomStatusHandler,
  deleteRoomHandler,
  deleteRoomImageHandler,
  listBedsHandler,
  createBedHandler,
  updateBedHandler,
  deleteBedHandler,
  setBedCountHandler,
};
