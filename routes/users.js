const express = require("express");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const moment = require("moment");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const {
    authenticate,
    authorize,
    apihit,
    inputValidation,
} = require("../middlewares/middlewares");
const { check, param } = require("express-validator");

// multer gdrive
const { google } = require("googleapis");
const GoogleDriveStorage = require("multer-google-drive");
const credentials = require("../credentials.json");
const scopes = ["https://www.googleapis.com/auth/drive"];
const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    scopes
);
const drive = google.drive({ version: "v3", auth });
const upload = multer({
    storage: GoogleDriveStorage({
        drive: drive,
        parents: "1tkgRWAYKeuxWAZCn8OWsjHID-g15sSK0",
        fileName: function (req, file, cb) {
            if (file != null) {
                // console.log(file);
                let extension = file.originalname.split(".").slice(-1)[0];
                if (
                    extension !== "png" &&
                    extension !== "jpg" &&
                    extension !== "gif" &&
                    extension !== "jpeg"
                ) {
                    return cb(new Error("Only images are allowed"));
                }
                filename =
                    crypto.randomBytes(20).toString("hex") + "." + extension;
                // cb(null, file.originalname + "." + extension);
                cb(null, filename);
            }
        },
    }),
});

const router = express.Router();
// model
const UserModel = require("../models/UserModel");

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

var filename = "";
// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, "./uploads");
//     },
//     filename: (req, file, cb) => {
//         if (file != null) {
//             // console.log(file);
//             let extension = file.originalname.split(".").slice(-1)[0];
//             filename = crypto.randomBytes(20).toString("hex") + "." + extension;
//             // cb(null, file.originalname + "." + extension);
//             cb(null, filename);
//         }
//     },
//     fileFilter: function (req, file, callback) {
//         console.log(file);
//         if (file != null) {
//             let extension = path.extname(file.originalname);
//             if (
//                 extension !== ".png" &&
//                 extension !== ".jpg" &&
//                 extension !== ".gif" &&
//                 extension !== ".jpeg"
//             ) {
//                 return callback(new Error("Only images are allowed"));
//             }
//             callback(null, true);
//         }
//     },
// });

// const upload = multer({ storage: storage });

async function getUploadedImage() {
    let image = null;
    let data = (await drive.files.list({})).data;
    if (data.files.length) {
        data.files.map((file) => {
            if (file.name == filename) {
                image = `https://drive.google.com/file/d/${file.id}/view?usp=sharing`;
            }
        });
    }
    return image;
}

/* view all users */
/* eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImFkbWluMUBhZG1pbi5jb20iLCJ1c2VybmFtZSI6ImFkbWluMSIsInBhc3N3b3JkIjoiYWRtaW4xIiwicm9sZSI6IjAiLCJpYXQiOjE2MTkyNDQ1Njd9.f6ShyIAVFSwY9-loZIsSoO9AJx1kTwaHj43DXYKmZgs */
router.get("/", [authenticate, authorize([0])], async (req, res) => {
    let users = await UserModel.select();
    if (users.length == 0)
        return res.status(404).send({ message: "no user found!" });
    users = users.map(({ name, username, email, role }) => ({
        name,
        username,
        email,
        role,
    }));
    return res.status(200).send(users);
});

/* login */
router.post(
    "/login",
    [
        [
            check("username")
                .notEmpty()
                .withMessage("username can not be empty")
                .trim()
                .escape(),
            check("password")
                .notEmpty()
                .withMessage("password can not be empty")
                .trim()
                .escape(),
        ],
        inputValidation,
    ],
    async (req, res) => {
        let { username, password } = req.body;
        let users = await UserModel.select(
            `where username = '${username}' and password = '${password}'`
        );
        if (users.length == 0) {
            return res.status(401).json({
                message: "Wrong username or password!",
            });
        } else {
            let user = users[0];
            return res.status(200).json({
                message: "Welcome, " + user.name,
                token: user.token,
                role: user.role,
                apihit: user.api_hit,
            });
        }
    }
);

/* register */
router.post(
    "/register",
    [
        upload.single("image"),
        [
            check("name", "name is empty").notEmpty().trim().escape(),
            check("email")
                .notEmpty()
                .withMessage("email is empty")
                .isEmail()
                .withMessage("wrong email format")
                .trim()
                .escape()
                .custom(async (value) => {
                    let result = await UserModel.select(
                        `WHERE email = '${value}'`
                    );
                    if (result.length > 0) return Promise.reject();
                })
                .withMessage("email is not available"),
            check("username").notEmpty().trim().escape(),
            check("username", "username is not available").custom(
                async (value) => {
                    let result = await UserModel.select(
                        `WHERE username = '${value}'`
                    );
                    if (result.length > 0) return Promise.reject();
                }
            ),
            check("password")
                .notEmpty()
                .withMessage("password is empty")
                .trim()
                .escape()
                .isLength({ min: 5 })
                .withMessage("password must be at least 5 chars long")
                .matches(/\d/)
                .withMessage("password must contain a number"),
            check(
                "confirm_password",
                "Password confirmation doesn't match"
            ).custom((value, { req }) => value === req.body.password),
            check("age")
                .notEmpty()
                .withMessage("age is empty")
                .isInt()
                .withMessage("age must be number")
                .trim()
                .escape(),
            check("role")
                .notEmpty()
                .withMessage("role is empty")
                .isIn([0, 1])
                .withMessage("role is not valid")
                .trim()
                .escape(), // role 0 admin, 1 user;
        ],
        inputValidation,
    ],
    async (req, res) => {
        let { name, email, username, password, age, role } = req.body;

        let image = await getUploadedImage();

        let user = {
            name: name,
            email: email,
            username: username,
            password: password,
            token: "",
            image: image,
            age: parseInt(age),
            role: role,
            balance: 0,
            api_hit: 100,
        };

        let result = await UserModel.insert(user);
        if (result.affectedRows == 0) {
            return res.status(400).json(result);
        } else {
            user.token = jwt.sign(
                {
                    id: result.insertId,
                    // email: email,
                    username: username,
                    // password: password,
                    role: role,
                },
                process.env.SECRET
            );

            // console.log(user);
            let update = await UserModel.update(user, result.insertId);
            // console.log(update);

            return res.status(201).json({
                name: user.name,
                email: user.email,
                username: user.username,
                token: user.token,
                age: user.age,
                image: image == null ? "No Image" : image,
                role: parseInt(user.role) === 1 ? "user" : "admin",
                balance: 0,
            });
        }
    }
);

/* update profile */
router.put(
    "/profile",
    [
        upload.single("image"),
        authenticate,
        authorize([1]),
        [
            check("name", "name is empty").notEmpty().trim().escape(),
            check("password")
                .notEmpty()
                .withMessage("password is empty")
                .trim()
                .escape()
                .isLength({ min: 5 })
                .withMessage("password must be at least 5 chars long")
                .matches(/\d/)
                .withMessage("password must contain a number"),
            check("age")
                .notEmpty()
                .withMessage("age is empty")
                .isInt()
                .withMessage("age must be number")
                .trim()
                .escape(),
        ],
        inputValidation,
    ],
    async (req, res) => {
        let { name, age, password } = req.body;

        let image = await getUploadedImage();

        let user = {
            name: name,
            image: image,
            password: password,
            age: age,
        };

        let result = await UserModel.update(user, req.user.id);
        if (result.affectedRows == 0) {
            return res.status(400).json(result);
        } else {
            return res.status(200).send(user);
        }
    }
);

/* tambah saldo user */
router.put(
    "/balance",
    [
        authenticate,
        authorize([1]),
        [
            check("balance")
                .notEmpty()
                .withMessage("balance is empty")
                .isInt()
                .withMessage("balance must be number")
                .trim()
                .escape(),
        ],
        inputValidation,
    ],
    async (req, res) => {
        let { balance } = req.body;

        let users = await UserModel.select(`where id = ${req.user.id}`);
        let logged_user = users[0];

        let user = {
            balance: parseInt(balance)+parseInt(logged_user.balance),
        };

        let result = await UserModel.update(user, req.user.id);
        if (result.affectedRows == 0) {
            return res.status(400).json(result);
        } else {
            return res.status(200).send(user);
        }
    }
);

/* reset api hit user */
router.put("/plans", async (req, res) => {
    // let { username, password } = req.body;
    // let reset_api_hit  = [100, 200, 300];

    // let user = await UserModel.select(
    //     `where username = '${username}' and password = '${password}'`
    // );
    // if (users.length == 0) {
    //     return res.status(401).json({
    //         message: "Wrong username or password!",
    //     });
    // } else {
    //     let user = users[0];
    //     return res.status(200).json({
    //         message: "Welcome, " + user.name,
    //         token: user.token,
    //     });
    // }
    return res.status(200).json({
        message: "Welcome, ",
        token: "test",
    });
});

/* view user detail */
router.get(
    "/:id",
    [
        [
            param("id")
                .notEmpty()
                .withMessage("id can not be empty")
                .trim()
                .escape(),
        ],
        inputValidation,
        authenticate,
        authorize([0]),
    ],
    async (req, res) => {
        let users = await UserModel.select(`where id = ${req.params.id}`);
        if (users.length == 0)
            return res.status(404).send({ message: "no user found!" });
        let user = users[0];
        return res.status(200).send(user);
    }
);

module.exports = router;
